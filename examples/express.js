"use strict";

/*
Visit localhost:1337 and play russian roulette!

This example shows how to write -or at least a good starting point- a robust
Node.js server that never breaks and has a single function that logs errors
(the global error handler) instead of having gazillions of try-catches with log
calls like Java.
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
	
	//Request error handler
	//Capture uncaught exceptions thrown during a request
	ex.use (app.errorHandler (function (error, req, res, preventDefault, bar){
		//With preventDefault the default error handler is not called
		//Here you'll typically send to the user a 500 error
		preventDefault ();
		
		res.send (500, "Bad luck" + (bar ? bar : "") + "!\n\nReason: " +
				error.message);
		
		app.shutdown ();
	}));
	
	ex.use (function (req, res, next){
		res.set ("content-type", "text/plain");
		
		attempts++;
		if (bullet--){
			res.send (200, "Nice... (" + attempts + " of " + bullets + ")");
		}else{
			/*
				3 errors that are handled by the request error handler if any, or by the
				default error handler:
				
				- Compile-time error, a TypeError.
				
					null.killer ();
				
				- Bound or intercepted using the request domain.
				
					require ("fs").readFile ("foo", "utf8", app.dom (req).intercept ());
					
				- Using the Express next() function:
				
					next (new Error ("foo"));
			*/
			
			//null.killer ();
			//require ("fs").readFile ("foo", "utf8", app.dom (req).intercept ());
			next (new Error ("foo"));
		}
	});
	
	//Thrown errors by the express middleware using next(error)
	//Redirects to the request error handler if any and falls back to the default
	//error handler if preventDefault is not called
	//You can pass any number of parameters and they'll be passed to the request
	//error handler and to the default error handler if an error is passed to the
	//next() function
	ex.use (app.redirectError (" bar"));
	
	ex.listen (1337, "localhost");
});

app.on ("shutdown", function (cb){
	console.log ("shutting down...");
	cb ();
});

app.on ("exit", function (code){
	console.log ("bye (" + code + ")");
});

app.timeout (1000, function (){
	//The shutdown event never hangs up so this code never executes
	console.error ("timed out");
});

app.start ();