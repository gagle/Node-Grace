"use strict";

/*
Every time localhost:1337 is visited a worker dies.
Each worker has access to the same log file.
*/

var http = require ("http");
var cluster = require ("cluster");
var os = require ("os");
var fs = require ("fs");
var grace = require ("../lib/grace");

//Log module
var log = {
	_file: "log",
	_stream: null,
	close: function (cb){
		if (!this._stream) return cb ();
		this._stream.on ("close", cb);
		this._stream.end ();
	},
	open: function (){
		if (this._stream) return;
		this._stream = fs.createWriteStream (this._file,
				{ flags: "a", encoding: "utf8" });
	},
	uncaught: function (error){
		//If the log it's not open print the error to console and exit
		if (error instanceof Error && error.code === "LOG_CLOSED"){
			console.error (error instanceof Error ? error.stack : error);
			app.shutdown (1);
			return;
		}
		
		try{
			//If this doesn't throw, the error is not LOG_CLOSED and the log has been
			//open correctly
			log.write (error);
		}catch (e){
			//e.code === "LOG_CLOSED"
			//The original error is not LOG_CLOSED but the log it's not open, so
			//first print the original error and then the LOG_CLOSED and exit because
			//it has no sense to continue if we can't log
			console.error (error instanceof Error ? error.stack : error);
			console.error (e instanceof Error ? e.stack : e);
			app.shutdown (1);
		}
	},
	write: function (msg){
		if (!this._stream){
			var e = new Error ("The log is closed");
			e.code = "LOG_CLOSED";
			throw e;
		}
		this._stream.write ((msg instanceof Error ? msg.stack : msg) + "\n",
				"utf8");
	}
};

var app = grace.create ();

app.on ("error", log.uncaught);

app.on ("start", function (){
	//Open a writable stream to the log file on all the workers (master included)
	log.open ();
	
	if (cluster.isMaster){
		var cpus = os.cpus ().length;
		var remaining = cpus;
		
		log.write ("MASTER: forking " + cpus + " worker/s");
		
		cluster.on ("online", function (worker){
			console.log ("MASTER: worker " + worker.process.pid + " is now online");
		});
		
		cluster.on ("exit", function (worker, code){
			console.log ("MASTER: worker " + worker.process.pid + " finished, code " +
					code);
			if (!--remaining){
				console.log ("MASTER: All workers have finished");
			}
		});
		
		for (var i=0; i<cpus; i++){
			cluster.fork ();
		}
	}else{
		log.write ("WORKER (" + process.pid + "): hello!");
		
		http.createServer (function (req, res){
			res.writeHead (200, { "content-type": "text/plain" });
			res.end ("Suicide!! (" + process.pid + ")");
			app.shutdown (100);
		}).listen (1337, "localhost", function (){
			log.write ("WORKER (" + process.pid + "): server up and listening");
		});
	}
});

app.on ("shutdown", function (cb){
	if (cluster.isMaster){
		//Close the log file on master
		log.close (function (){
			//Gracefully disconnect workers from the master on ctrl-c
			//If there's no active workers the disconnect() function is no-op
			cluster.disconnect (cb);
		});
	}else{
		log.write ("WORKER (" + process.pid + "): bye!");
		
		//Close the log file on each worker
		log.close (cb);
	}
});

app.on ("exit", function (code){
	console.log ((cluster.isMaster ? "MASTER" : "WORKER") + ": bye! (" + code +
			")");
});

app.timeout (1000, function (cb){
	console.error ((cluster.isMaster ? "MASTER" : "WORKER (" + process.pid +
			")") + ": forced shutdown");
	cb ();
});

app.start ();