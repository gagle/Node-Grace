"use strict";

var events = require ("events");
var domain = require ("domain");
var util = require ("util");
var ep = require ("error-provider");
var readLine = require ("readline");
var cluster = require ("cluster");

ep.create (ep.next (), "GRACEFUL_SHUT_START",
		"Cannot start the graceful application more than one time");

var WIN = process.platform === "win32";

var GRACEFUL_SHUT_EVENT = "GRACEFUL-SHUT-before-disconnect";

var gs = module.exports = {};
var rl;

gs.create = function (){
	return new Grace ();
};

var Grace = function (onStart){
	events.EventEmitter.call (this);
	this._domain = domain.create ();
	this._shutdown = false;
	this._started = false;
	this._timeout = null;
	this._disconnectCallback = null;
};

util.inherits (Grace, events.EventEmitter);

Grace.prototype._masterExit = function (code){
	if (cluster.isWorker) return;
	var me = this;
	this._domain.on ("dispose", function (){
		//Exit on next tick to allow remaining events to be fired, e.g. cluster exit
		//events
		process.nextTick (function (){
			if (WIN && me._ctrlc) process.stdout.write ("^C");
			process.exit (code);
		});
	});
	this._domain.dispose ();
};

Grace.prototype._workerExit = function (){
	if (cluster.isMaster) return;
	var me = this;
	if (!me._disconnectCallback){
		//shutdown() was called directly on the worker, call to destroy()
		cluster.worker.destroy ();
	}else{
		//Call to the original disconnect and try to gracefully shutdown
		me._disconnectCallback ();
	}
};

Grace.prototype._overrideDisconnect = function (){
	if (cluster.isMaster) return;
	var me = this;
	
	//In order to gracefully shutdown when a worker disconnects, a custom event
	//must be emitted to listen to it and call the shutdown function
	//Cannot listen to the "exit" event on each created worker because the event
	//loop stops working and doesn't accept more asynchronous callbacks so no
	//clean up tasks can me made there
	var disconnect = cluster.Worker.prototype.disconnect;
	cluster.Worker.prototype.disconnect = function (){
		var worker = this;
		this.emit (GRACEFUL_SHUT_EVENT, function (){
			disconnect.call (worker);
		});
	};
	
	cluster.worker.on (GRACEFUL_SHUT_EVENT, function (cb){
		//Save disconnect callback to call it when the shutdown task finishes
		me._disconnectCallback = cb;
		me.shutdown ();
	});
};

Grace.prototype.dom = function (){
	return this._domain;
};

var cleanError = function (error){
	delete error.domain;
	delete error.domain_emitter;
	delete error.domain_bound;
	delete error.domain_thrown;
	return error;
};

var eachWorker = function (cb){
	for (var id in cluster.workers){
		cb (cluster.workers[id]);
	}
};

Grace.prototype.start = function (){
	if (this._started) throw ep.get ("GRACEFUL_SHUT_START");
	this._started = true;
	
	this._overrideDisconnect ();
	
	var me = this;
	
	var onStart = this.listeners ("start");
	onStart = onStart.length ? onStart[0] : null;
	if (!onStart) return this.shutdown ();
	
	this._domain.on ("error", function (error){
		//Thrown exceptions in the error listener exits the process, be careful
		me.emit ("error", cleanError (error));
	});
	
	//Only read stdin on the master
	if (WIN && cluster.isMaster){
		rl = readLine.createInterface ({
			input: process.stdin,
			output: process.stdout
		});

		rl.on ("SIGINT", function (){
			process.emit ("SIGINT");
		});
	}
	
	//The synchronous domain initialization is try-catched so compile-time
	//errors during synchronous initialization are treated different than
	//pure domain "uncaught exceptions"
	try{
		this._domain.run (onStart);
		
		if (WIN && cluster.isMaster){
			//On Windows if there's no more active workers the master must stop
			//reading the stdin in order to die
			//On Linux the master dies automatically
			var workers = Object.keys (cluster.workers).length;
			eachWorker (function (worker){
				worker.on ("exit", function (){
					if (!--workers){
						rl.close ();
					}
				});
			});
		}
	}catch (error){
		//If an exception occurs during synchronous initialization, emit error
		//and shutdown
		this.emit ("error", error);
		this.shutdown ();
	}
	
	//Cannot listen to the "exit" event because it's not possible to add
	//asynchronous tasks
	process.on ("SIGINT", function (){
		me._ctrlc = true;
		me.shutdown ();
	});
};

Grace.prototype.shutdown = function (){
	if (this._shutdown) return;
	this._shutdown = true;
	
	var me = this;
	
	var onShutdown = this.listeners ("shutdown");
	onShutdown = onShutdown.length ? onShutdown[0] : null;
	if (!onShutdown){
		return cluster.isMaster ? this._masterExit (0) : this._workerExit ();
	}
	
	var timer = {
		id: null,
		set: function (fn){
			this.id = setTimeout (function (){
				if (me._timeout.cb){
					me._timeout.cb (fn);
				}else{
					fn ();
				}
			}, me._timeout.ms);
		},
		clear: function (){
			clearTimeout (this.id);
		}
	};
	
	var forced = false;
	
	var force = function (){
		if (cluster.isMaster){
			//Force shutdown and destroy all the remaining workers if any
			//Child processes will be automatically destroyed when the master exits
			forced = true;
			
			var remaining = Object.keys (cluster.workers).length;
			if (!remaining) return me._masterExit (1);
			eachWorker (function (worker){
				worker.on ("exit", function (){
					if (!--remaining){
						me._masterExit (1);
					}
				});
				worker.destroy ();
			});
		}else{
			me._workerExit ();
		}
	};
	
	if (this._timeout){
		//Set a timeout to force exit
		timer.set (force);
	}
	
	if (WIN && cluster.isMaster){
		//If shutdown() is called from the master then stop reading the stdin
		rl.close ();
	}
	
	this._domain.run (function (){
		//Try-catched to redirect synchronous compile-time errors to the domain
		//"error" event listener
		try{
			onShutdown (function (error){
				//When shutting down workers this check is needed because the master
				//can be locked because there are workers listening a long living
				//connection, so when the workers are killed the master continues
				//executing the shutdown listener
				//Also is a sanity check to prevent undesirable effects
				if (forced) return;
				
				timer.clear ();
				
				if (error){
					me.emit ("error", cleanError (error));
					//if (cluster.isWorker) me._workerExit ()
					cluster.isMaster ? me._masterExit (1) : me._workerExit ();
				}else{
					//if (cluster.isWorker) me._workerExit ()
					cluster.isMaster ? me._masterExit (0) : me._workerExit ();
				}
			});
		}catch (error){
			me.emit ("error", error);
		}
	});
};

Grace.prototype.timeout = function (ms, cb){
	this._timeout = {
		ms: ms,
		cb: cb
	};
};