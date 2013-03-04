"use strict";

/*
Visit localhost:1337 and play russian roulette!

Does the same than "express.js" but without Express
*/

var http = require ("http");
var grace = require ("../lib/grace");

var app = grace.create ();

app.on ("error", function (error){
	console.error (error.stack);
});

app.on ("start", function (){
	var bullets = 6;
	var bullet = Math.floor (Math.random ()*bullets);
	console.log ("bullet in chamber " + (bullet + 1));
	var attempts = 0;
	
	http.createServer (function (req, res){
		var next = function (){
			attempts++;
			if (bullet--){
				res.writeHead (200, { "content-type": "text/plain" });
				res.end ("Nice... (" + attempts + " of " + bullets + ")");
			}else{
				null.killer;
			}
		};
	
		app.errorHandler (function (error, req, res, preventDefault){
			preventDefault ();
			
			res.writeHead (500, { "content-type": "text/plain" });
			res.end ("Bad luck " + req.connection.remoteAddress + "!\n\nReason: " +
					error.message);
			
			app.shutdown (1);
		})(req, res, next);
	}).listen (1337, "localhost");
});

app.on ("shutdown", function (cb){
	console.log ("shutting down");
	cb ();
});

app.on ("exit", function (code){
	console.log ("bye (" + code + ")");
});

app.timeout (1000, function (){
	console.error ("timed out, forcing shutdown");
});

app.start ();