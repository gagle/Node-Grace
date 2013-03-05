"use strict";

/*
Visit localhost:1337 and play russian roulette!

This example shows how to write -or at least a good starting point- a robust
Node.js server that never breaks and has 2 controlled points for handling errors
(default and request error handlers) instead of having gazillions of try-catches
like Java.
*/

var express = require ("express");
var grace = require ("../lib/grace");

var app = grace.create ();

//Default error handler
app.on ("error", function (error){
	//Never prints because the request error handler calls to preventDefault
	//Here you'll typically log the error with the highest level (maximum
	//priority) and you'll probably never use the preventDefault function
	console.error (error);
});

app.on ("start", function (){
	var bullets = 6;
	var bullet = Math.floor (Math.random ()*bullets);
	console.log ("bullet in chamber " + (bullet + 1));
	var attempts = 0;
	
	var ex = express ();
	ex.disable ("x-powered-by");
	
	//Request error handler, this should be the first middleware
	//Capture uncaught exceptions thrown during a request
	ex.use (app.errorHandler (function (error, req, res, preventDefault){
		//With preventDefault the default error handler is not called
		//Here you'll typically send to the user a 500 error
		preventDefault ();
		
		res.send (500, "Bad luck " + req.connection.remoteAddress +
				"!\n\nReason: " + error.message);
		
		app.shutdown (1);
	}));
	
	var shoot = function (req, res, next){
		res.set ("content-type", "text/plain");
		
		attempts++;
		if (bullet--){
			res.send (200, "Nice... (" + attempts + " of " + bullets + ")");
		}else{
			/*
				3 types of errors that are handled by the request error handler if any,
				or by the default error handler:
				
				- Parse error.
				
					null.killer;
				
				- Bound or intercepted using the request domain.
				
					require ("fs").readFile ("foo", "utf8", app.dom (req).intercept ());
					
				- Using the Express next() function:
				
					next (new Error ("foo"));
			*/
			
			null.killer;
			//require ("fs").readFile ("foo", "utf8", app.dom (req).intercept ());
			//next (new Error ("foo"));
		}
	};
	
	ex.get ("/", shoot);
	
	//Express error handler, this should be the last middleware
	//Redirects to the request error handler if any and falls back to the default
	//error handler if preventDefault is not called
	//You can pass any number of parameters and they'll be passed to the error
	//handler
	
	//2 ways to use the Express error handler:
	//Shorthand
	//ex.use (app.redirectError ());
	//If you need to do anything before redirecting to the request error handler
	ex.use (function (error, req, res, next){
		app.redirectError (error, req, res);
	});
	
	ex.listen (1337, "localhost");
});

app.on ("shutdown", function (cb){
	console.log ("shutting down");
	cb ();
});

app.on ("exit", function (code){
	console.log ("bye (" + code + ")");
});

app.timeout (1000, function (){
	//The shutdown event never hangs up so this code never executes
	console.error ("timed out, forcing shutdown");
});

app.start ();