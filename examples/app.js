"use strict";

var fs = require ("fs");
var grace = require ("../lib/grace");

var app = grace.create ();
var s;

app.on ("error", function (error){
	console.error (error instanceof Error ? error.stack : error);
});

app.on ("start", function (){
	//The error event is automatically listened by the domain because all the
	//error events emitted by an EventEmitter are catched by the domain
	s = fs.createWriteStream ("tmp");
	
	//On Windows shutdown() must be called in order to call the shutdown listener
	//and exit. On linux is not needed to finish the process but the shutdown
	//listener won't be called. Therefore, if you want to always call the shutdown
	//listener, always call to shutdown().
	app.shutdown ();
});

app.on ("shutdown", function (cb){
	s.on ("close", function (){
		fs.unlink ("tmp", cb);
		
		/*
			Different ways to do the same:
			
			fs.unlink ("tmp", function (error){
				cb (error);
			});
			
			fs.unlink ("tmp", app.dom ().intercept (cb));
			
			fs.unlink ("tmp", app.dom ().intercept (function (){
				cb ();
			}));
		*/
	});
	s.end ();
});

app.on ("exit", function (code){
	console.log ("bye (" + code + ")");
});

//Always set a timeout or the process will never end if the shutdown listener
//never calls the callback due to an error or whatever
app.timeout (1000, function (cb){
	console.log ("timed out, forcing shutdown");
	cb ();
});

app.start ();