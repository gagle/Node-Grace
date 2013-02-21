"use strict";

//Visit localhost:1337 and play russian roulette!

var http = require ("http");
var gs = require ("../lib/graceful-shut");

var app = gs.create ();

app.on ("error", function (error){
	if (error instanceof Error && error.message === "REQUEST"){
		error.res.writeHead (500, { "content-type": "text/plain" });
		error.res.end (error.description);
		app.shutdown ();
	}else{
		console.error (error);
	}
});

app.on ("start", function (){
	var bullets = 6;
	var bullet = Math.floor (Math.random ()*bullets);
	var attempts = 0;
	
	http.createServer (function (req, res){
		attempts++;
		if (bullet--){
			res.writeHead (200, { "content-type": "text/plain" });
			res.end ("Nice... (" + attempts + " of " + bullets + ")");
		}else{
			var e = new Error ("REQUEST");
			e.description = "Bad luck!";
			e.res = res;
			throw e;
		}
	}).listen (1337, "127.0.0.1");
});

app.start ();