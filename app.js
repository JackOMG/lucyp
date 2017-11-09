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
        session.send("Hi... I'm the Crypto X Bot. I can help you buy your crypto currencies");
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
        builder.Prompts.choice(session, "What can I do for you?", "ask|quiz|know|review");
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
		builder.Prompts.text(session, "That is an interesting question, I dont know the answer yet but I will try to find out for you.");
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

bot.dialog('playquiz', [
    function (session) {
		builder.Prompts.text(session, "Cool lets play a quiz. About what topic?");	
	},
	function (session, results) {
		db.collection('quizQuestions').find({topic: results.response}).sort({asked: 1}).limit(1).toArray(function(err, row) {
			if (err) console.log(err)
			if (row[0]) {
				session.userData.quizQuestion = row[0]
				builder.Prompts.choice(session, row[0].quizQuestion, "True|False");
				// update question asked counter
				var ObjectId = require('mongodb').ObjectId;
				db.collection('quizQuestions').update({_id:  ObjectId(session.userData.quizQuestion._id)}, {$inc: {asked: 1}});
			} else {
				session.endDialog("I have no quiz questions about this topic.")
			}
		})
	},
	function (session, results) {
		if (session.userData.quizQuestion.correctAnswer == results.response.entity) {
			session.endDialog('Your answer is correct')
		} else {
			session.endDialog('Unfortunatly your answer is wrong')
		}
	}		
])

bot.dialog('quizContribute', [
    function (session) {
		builder.Prompts.text(session, "What is the topic?");	
	},
	function (session, results) {
		session.userData.quizTopic = results.response
		builder.Prompts.text(session, "What is the quiz question? State your question as a statement that can be True or False");	
	},
	function (session, results) {
		session.userData.quizQuestion = results.response
		builder.Prompts.choice(session, "What is the correct answer?","True|False");	
	},
	function (session, results) {	
		db.collection('quizQuestions').insert({userId: session.message.address.user.id, 
			topic: session.userData.quizTopic,
			quizQuestion: session.userData.quizQuestion,
			correctAnswer: results.response.entity,
			asked: 0,
			date:(new Date()).getTime()
		})
		session.endDialog("Thank you so much for your contribution")
	}	
])

bot.dialog('/know', [
	function (session) {
		builder.Prompts.choice(session, "Manage your account", "balances|open orders");
	},
	function (session, results) {
		switch (results.response.entity) {
			case 'balances':
				db.collection('balances').find({userId: session.message.address.user.id}).toArray(function(err, balances) {
					var msg = 'Your balances:\n\n'
					for (var i in balances) {
						if (balances[i].currency == 'USD')
							msg = msg + 'USD: '+balances[i].balance.toFixed(2) +'\n\n'
						else
							msg = msg + balances[i].currency + ': '+balances[i].balance +'\n\n'
					}
					session.send(msg)
					session.endConversation()
					session.beginDialog('/start')
				})
				break;
			case 'open orders':
				// first list buy orders
				db.collection('orders').find({userId: session.message.address.user.id}).toArray(function(err, orders) {
					console.log('Orders %j', orders)
					if (orders.length<1) {
						// no open orders
						session.send('You have no outstanding open orders.')
						session.endConversation()
						session.beginDialog('/start')
					} else {
						var msg = 'Your outstanding orders: \n\n'
						for (var i = 0; i < orders.length; i++) {
							msg = msg+'#'+(i+1)+': '+(orders[i].trade == "B" ? "Buy " : "Sell ")+orders[i].volume + ' '+orders[i].currency + ' at $'+ orders[i].price +'\n\n'
						}
						session.userData.openOrders = orders
						session.send(msg)
						session.beginDialog('cancelOrders')
					}
				})
				break;
		}
	}
]).triggerAction({matches: /^(a|A)ccount$/});

bot.dialog('cancelOrders', [
    function (session) {
		builder.Prompts.confirm(session, 'Would you like to cancel any orders?');
	},
    function (session, results) {
		if (results.response) {
			builder.Prompts.number(session, 'Which order# would you like to cancel?');
			}
		else {	
			session.endConversation();
			session.beginDialog('/start')	
		}
	},
	function(session, results) {
		if (results.response < 1 || results.response > session.userData.openOrders.length + 1)
			session.send('Order number is not valid.')
		else {
			// cancel this order
			var vol = session.userData.openOrders[results.response - 1].volume
			var cur = session.userData.openOrders[results.response - 1].currency
			var amount = session.userData.openOrders[results.response - 1].amount
			// update the balance on order
			if (session.userData.openOrders[results.response - 1].trade == 'B') 
				// for buy order update USD balance
				db.collection('balances').update({userId:  session.message.address.user.id, currency: 'USD'}, {$inc: {balanceOrders: -amount}});
			else
				// for sell orders update the currency balance
				db.collection('balances').update({userId:  session.message.address.user.id, currency: cur}, {$inc: {balanceOrders: -vol}});
			
			// delete the order from the table
			var ObjectId = require('mongodb').ObjectId;
			db.collection('orders').deleteOne( {"_id": ObjectId(session.userData.openOrders[results.response - 1]._id)});
			session.send('Order #'+results.response+' has been cancelled.');	
		}
		session.endConversation();
		session.beginDialog('/start')
    } 
	
])

function checkBalance(session) {
	// find the balance for this user
	// if user wants to buy he needs to have balance in USD, if he wants to sell he needs to have balance in the currency he wants to sell
	var currency = (session.userData.trade == 'B' ? 'USD' : session.userData.currency) 
	db.collection('balances').findOne({userId: session.message.user.id, currency: currency}, function(err, user) {
		if (err) console.log(err)
		if (user) {
			session.userData.balance = user.balance - user.balanceOrders
			if (currency == 'USD')
				var msg = 'Your balance is: $'+user.balance.toFixed(2)+'. Balance on order is: $'+user.balanceOrders.toFixed(2)+' Available to spend: $'+ session.userData.balance.toFixed(2)
			else
				var msg = 'Your balance is: '+user.balance+currency+'. Balance on order is: '+user.balanceOrders+currency+' Available to spend: '+ session.userData.balance+currency
			session.send(msg)
			// we have enough balance lets continue
			var pair = session.userData.currency + '_USD'
			Exchanges.kraken.ticker(pair)
				.then(function (text) {
					console.log(text)
					for (var i in text) {
						session.userData.price = (session.userData.trade == 'B' ? text[i].ask : text[i].bid)
					}
					session.send('Price is currently: '+text[i].ask + ' USD')
					session.beginDialog('getPrice');
				})
				.catch(function(reason) {
					session.send('The currency: '+session.userData.currency+' does not exist. At the moment we only support currencies traded on Kraken. Enter 3 letter currency code such as BTC, ETH, LTC')
					session.endConversation()
					session.beginDialog('/start')
				});
		}
		else {
			// no balance found. check if this is to buy, we give every user 10k of free USD
			if (currency == 'USD') {
				// give a new user a balnce of $10,000
				db.collection('balances').insertOne({userId: session.message.address.user.id,
					currency: currency,
					balance: 10000,
					balanceOrders: 0,
					})	
				session.send('As a new user you have been given a balance of: 100,000 USD')
				session.userData.balance = 100000
				var pair = session.userData.currency + '_USD'
				Exchanges.kraken.ticker(pair)
					.then(function (text) {
						console.log(text)
						for (var i in text) {
							session.userData.price = (session.userData.trade == 'B' ? text[i].ask : text[i].bid)
						}
						session.send('Price is currently: '+text[i].ask + ' USD')
						session.beginDialog('getPrice');
					})
					.catch(function(reason) {
						session.send('The currency: '+session.userData.currency+' does not exist. At the moment we only support currencies traded on Kraken. Enter 3 letter currency code such as BTC, ETH, LTC')
						session.endConversation()
						session.beginDialog('/start')
				});
			} else {
				session.send('You dont have enough balance available.')
				session.endConversation()
				session.beginDialog('/start')
			}
		}
	})
	
}

bot.dialog('getPrice', [
    function (session,args) {	
		var msg = "At what price would you like to "+(session.userData.trade == 'B' ? 'buy' : 'sell') +  "? Enter 0 for marketorder."
		if (args && args.reprompt) {
			if (args.reprompt == "neg") var msg = 'Price can not be negative. ' + msg
			if (args.reprompt == "bal") var msg = 'Total order value exceeds your balance. ' + msg
		}
		builder.Prompts.number(session, msg);
	},
	function(session, results) {
		if (results.response < 0) {
			session.replaceDialog('getPrice', { reprompt: "neg" });
		} else {
			if (results.response == 0) 
				session.userData.orderType = 'M'
			else {
				session.userData.orderType = 'L'
				session.userData.price = results.response
			}
			session.replaceDialog('getvolume')
			//builder.Prompts.number(session, "What volume?");
			//session.endDialogWithResult({ response: results.response });
		}
	}	
])

bot.dialog('getvolume', [
    function (session, args) {	
		if (args && args.reprompt) {
			if (args.reprompt == "neg") session.send('Amount has to be positive.')
			if (args.reprompt == "bal") session.send('Amount exceeds your current balance.')
		}
		var msg = "What amount would you like to "+(session.userData.trade == 'B' ? 'buy' : 'sell') +"?"
		builder.Prompts.number(session, msg);
	},
	function(session, results) {
		session.userData.volume = results.response;
		if (results.response <= 0) 
			session.replaceDialog('getvolume', { reprompt: "neg" })
		else {	
			// check if enough balance available
			if (session.userData.trade == 'B') {
				// we are buying we need to do price * amount to calculate balance needed
				var totalOrderAmount = session.userData.volume * session.userData.price
				if (totalOrderAmount > session.userData.balance)
					session.replaceDialog('getPrice', { reprompt: "bal" });
				else	
					session.endDialogWithResult({ response: results.response })
			} else {
				// we are selling, we just need the amount available that we want to sell
				if (session.userData.volume > session.userData.balance)
					session.replaceDialog('getvolume', { reprompt: "bal" })
				else
					session.endDialogWithResult({ response: results.response })
			}
		}
	}	
])

bot.dialog('/trade', [
    function (session) {
		var msg = "What crypto would you like to " + (session.userData.trade == 'B' ? 'buy' : 'sell')+'?'
		builder.Prompts.text(session, msg);
	},
	function(session, results) {
		session.userData.currency = results.response.toUpperCase();
		//if buying need balance in USD (base currency) if selling need balance of selling currency
		checkBalance(session)
    }, 	
	function(session, results) {
		//var buyprice = session.userData.price ? session.userData.price : session.userData.marketprice
		var confirm = 'Please confirm that you want to ' + (session.userData.trade == 'B' ? 'BUY ' : 'SELL ')
		confirm = confirm +session.userData.volume+' '+session.userData.currency+ ' at $'+session.userData.price +' Total: $'+ session.userData.volume * session.userData.price
		builder.Prompts.confirm(session, confirm);
    },	
    function (session, results) {
		if (results.response) {
			var msg = 'Thank you. Your order has been placed'
			processOrder(session)
			}
		else var msg = 'OK, Your order has been cancelled'
        session.endConversation(msg);
		session.beginDialog('/start')
	}			
])

function processOrder(session) {

	var amount = session.userData.volume * session.userData.price
	var vol = session.userData.volume *1

	
	// process marketorders directly
	if (session.userData.orderType == 'M') {
		console.log('process market order')
		db.collection('trades').insertOne({userId: session.message.address.user.id, 
				userName: session.message.address.user.name, 
				date:(new Date()).getTime(),
				currency: session.userData.currency,
				price: session.userData.price,
				volume: vol,
				amount: amount,
				trade: session.userData.trade,
				ordertype: session.userData.orderType
				})	
		//update balances
		if (session.userData.trade == 'B') {
			// buying reduce the base currency. Later we can use different base currency than USD
			db.collection('balances').updateOne({userId:  session.message.address.user.id, currency: "USD"}, {$inc: {balance: -amount}});
			db.collection('balances').update({userId:  session.message.address.user.id, currency: session.userData.currency}, {$inc: {balance: vol, balanceOrders:0}}, { upsert: true });		
		} else {
			// whilst selling increase the base currency
			db.collection('balances').updateOne({userId:  session.message.address.user.id, currency: "USD"}, {$inc: {balance: amount}});
			db.collection('balances').update({userId:  session.message.address.user.id, currency: session.userData.currency}, {$inc: {balance: -vol, balanceOrders:0}}, { upsert: true });				
		}

	} else {
		// process limit orders later, just enter them in orders table.
		console.log('process limit order')
		db.collection('orders').insertOne({userId: session.message.address.user.id, 
			userName: session.message.address.user.name, 
            date:(new Date()).getTime(),
			currency: session.userData.currency,
			price: session.userData.price,
			volume: vol,
            amount: amount,
			trade: session.userData.trade,
			ordertype: session.userData.orderType
			})
		// update balanceonorders
		if (session.userData.trade == 'B') 
			db.collection('balances').updateOne({userId:  session.message.address.user.id, currency: "USD"}, {$inc: {balanceOrders: amount}});
		else	
			db.collection('balances').updateOne({userId:  session.message.address.user.id, currency: session.userData.currency}, {$inc: {balanceOrders: vol}});			
	}
	
}

bot.dialog('/db', [
    function (session) {
		builder.Prompts.text(session, "Database entry");
		/*
		db.collection('users').findOne({userId: session.message.user.id}, function(err, user) {
			if (err) console.log(err)
			console.log('User:%j', user)
		})
		db.collection('balances').find({userId: session.message.user.id}).toArray(function(err, balances) {
			for (i in balances) {
				console.log(balances[i].currency + ':'+balances[i].balance)
			}
		})
		//update
		//db.collection('balances').updateOne({userId: session.message.user.id, currency: "USDt"}, {$set: {balance: 6000}});
		
		//insert
		db.collection('balances').insertOne({userId: session.message.user.id, currency: "USD", balance: 10000})
		*/
	},
    function (session, results) {
        session.endConversation("You chose '%s'", results.response ? 'yes' : 'no');
		session.beginDialog('/start')
	}			
]).triggerAction({matches: /^(D|d)b$/});

