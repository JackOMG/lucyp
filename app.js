const restify = require('restify');
const builder = require('botbuilder');
const MongoClient = require('mongodb').MongoClient;
//const Exchanges = require('crypto-exchange')

global.db=null; //database handle
MongoClient.connect(process.env.mongoConnect||"mongodb://localhost:27017", function(err, database) {
  if(!err) {
    console.log("DB connected");
	db = database;
  } else console.log(err.stack);
});

//=========================================================
// Bot Setup
//=========================================================

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat bot
var connector = new builder.ChatConnector({
    appId: process.env.AppId,
    appPassword: process.env.AppPassword,
});
var bot = new builder.UniversalBot(connector);
server.post('/api/messages', connector.listen());

//=========================================================
// Bots Middleware
//=========================================================

// Anytime the major version is incremented any existing conversations will be restarted.
bot.use(builder.Middleware.dialogVersion({ version: 1.0, resetCommand: /^reset/i }));

//=========================================================
// Bots Global Actions
//=========================================================

bot.endConversationAction('goodbye', 'Goodbye :)', { matches: /^goodbye/i });
//bot.beginDialogAction('search','/search', { matches: /^search/i });
//bot.beginDialogAction('account','/account','my account', { matches: /^account/i });


//=========================================================
// Bots Dialogs
//=========================================================

bot.dialog('/', [
    function (session) {
        session.send("Hi... I'm the ING Quiz Bot. I can help you learn about new topics");
		db.collection('users').insert({userId: session.message.address.user.id, 
			userName: session.message.address.user.name, 
			date:(new Date()).getTime(),
			address: session.message.address
		})	
        session.beginDialog('/start');
    },
    function (session, results) {
        // Always say goodbye
        session.send("Ok... See you later!");
    }
]);

bot.dialog('/start', [
    function (session) {	
        builder.Prompts.choice(session, "What can I do for you?", "ask|quiz|account");
    },
    function (session, results) {
		console.log('results:'+results.response.entity)
        if (results.response && results.response.entity != '(quit)') {
            // Launch demo dialog
            session.beginDialog('/' + results.response.entity);
        } else {
            // Exit the menu
            session.endDialog();
        }
    },
    function (session, results) {
        // The menu runs a loop until the user chooses to (quit).
        session.replaceDialog('/start');
    }
]).reloadAction('reloadMenu', null, { matches: /^start|show menu/i });

bot.dialog('/ask', [
    function (session) {
		builder.Prompts.text(session, "What is your question?");
	},
	function (session, results) {
		session.userData.question = results.response
		builder.Prompts.text(session, "Ok. Can you help me with some keywords so I can find the right expert to ask?");
	},
	function (session, results) {
		session.userData.keywords = results.response
		// add to the questions table
		db.collection('questions').insert({userId: session.message.address.user.id, 
			userName: session.message.address.user.name, 
			date:(new Date()).getTime(),
			address: session.message.address,
			question: session.userData.question,
			keywords: results.response
		})
		var msg = "Ok I will look for an expert in: " + results.response +' and ask him the following question: '+ session.userData.question
		session.endDialog(msg);
	}	
]).triggerAction({matches: /^(A|a)sk$/});

bot.dialog('/quiz', [
    function (session) {
		builder.Prompts.choice(session, "Would you like to play a quiz or contribute a question","play|contribute");
	},
	function (session, results) {
		if (results.response.entity == 'play')
			session.beginDialog('playquiz')
		else
			session.beginDialog('quizContribute')
	}	
]).triggerAction({matches: /^(Q|q)uiz$/});

bot.dialog('/account', [
    function (session) {
		db.collection('users').findOne({userId: session.message.user.id}, function(err, user) {
			if (err) console.log(err)
			if (user) {
				if (user.questions)
					session.send('You have answered '+user.questions+' questions. Of these you had '+user.correct+' correct and '+user.wrong+' wrong.');
				else 
					session.send('You have not yet participated in a quiz')
				// check if user has areas of expertise filled in
				if (user.expertise) {
					session.endDialog('Your areas of expertise are: ' + user.expertise)
				} else {
					session.beginDialog('userExpertise')
				}
				
			} else {
				session.send('I could not find your account info')
			}
		})
	}	
]).triggerAction({matches: /^(A|a)ccount$/});

bot.dialog('userExpertise', [
    function (session) {
		builder.Prompts.text(session, "What are you areas of expertise? Tell me in short words seperated by commas. For example: Payments, KYC, AML");
	},
	function (session, results) {
		session.endDialog("Great! If I get some questions on: "+results.response+" I will surely contact you")
		db.collection('users').update({userId: session.message.address.user.id}, 
		{$set: {expertise: results.response}})
	}	
])

bot.dialog('playquiz', [
    function (session) {
		builder.Prompts.text(session, "Cool lets play a quiz. About what topic?");	
	},
	function (session, results) {
		db.collection('quizQuestions').find({topic: results.response}).collation({locale: "en", strength:2}).sort({asked: 1}).limit(1).toArray(function(err, row) {
			if (err) console.log(err)
			if (row[0]) {
				session.userData.quizQuestion = row[0]
				builder.Prompts.choice(session, row[0].quizQuestion, "True|False");
				// update question asked counter
				var ObjectId = require('mongodb').ObjectId;
				db.collection('quizQuestions').update({_id:  ObjectId(session.userData.quizQuestion._id)}, {$inc: {asked: 1}});
			} else {
				// no questions on this topic. show most popular topics
				db.collection('topics').find({}).sort({questions: -1}).limit(10).toArray(function(err, rows) {
					var msg = 'I have no questions on: '+results.response+'\n\nHere are the most popular topics: '
					for (var i in rows) {
						msg = msg + rows[i].topic + ' ('+rows[i].questions+'), '
					}
					session.endDialog(msg)
				})

			}
		})
	},
	function (session, results) {
		// update stats for the user
		var correct = (session.userData.quizQuestion.correctAnswer == results.response.entity ? 1:0)
		var wrong = (session.userData.quizQuestion.correctAnswer == results.response.entity ? 0:1)
		console.log('Correct: %s Wrong %s', correct, wrong)
		db.collection('users').update({userId: session.message.address.user.id}, 
		{$inc: {questions: 1, correct: correct, wrong: wrong}}, { upsert: true })
		
		if (session.userData.quizQuestion.correctAnswer == results.response.entity) {
			session.endDialog('Your answer is correct')
		} else {
			var msg = 'Unfortunatly your answer is wrong. '+session.userData.quizQuestion.explanation
			session.endDialog(msg)
		}
	}		
])

bot.dialog('quizContribute', [
    function (session) {
		builder.Prompts.text(session, "What is the topic?");
	},
	function (session, results) {
		session.userData.quizTopic = results.response.toLowerCase()
		builder.Prompts.text(session, "What is the quiz question? State your question as a statement that can be True or False");	
	},
	function (session, results) {
		session.userData.quizQuestion = results.response
		builder.Prompts.choice(session, "What is the correct answer?","True|False");	
	},
	function (session, results) {
		session.userData.correctAnswer = results.response.entity
		builder.Prompts.text(session, "Please provide an explanation if a wrong answer is given");	
	},
	function (session, results) {	
		db.collection('quizQuestions').insert({userId: session.message.address.user.id, 
			topic: session.userData.quizTopic,
			quizQuestion: session.userData.quizQuestion,
			correctAnswer: session.userData.correctAnswer,
			explanation: results.response,
			asked: 0,
			date:(new Date()).getTime()
		})
		// update the Topics to keep track how many questions on this topic
		db.collection('topics').update({topic: session.userData.quizTopic}, {$inc: {questions: 1}}, { upsert: true });	
		
		session.endDialog("Thank you so much for your contribution")
	}	
])

// Middleware for logging
bot.use({
	botbuilder: function (session, next) {
	    var event = session.message;
		// check for referral
		if(event.sourceEvent.postback && event.sourceEvent.postback.referral)	{
			db.collection('referrals').insert({userId: session.message.address.user.id, 
				userName: session.message.address.user.name, 
				date:(new Date()).getTime(),
				address: session.message.address,
				referral: event.sourceEvent.postback.referral.ref
			})
		} else if (event.sourceEvent.referral) {
			db.collection('referrals').insert({userId: session.message.address.user.id, 
				userName: session.message.address.user.name, 
				date:(new Date()).getTime(),
				address: session.message.address,
				referral: event.sourceEvent.referral.ref
			})
		}
		next();
       }
});

