"use strict";

var http = require ("http");
var events = require ("events");
var domain = require ("domain");
var util = require ("util");
var ep = require ("error-provider");
var readLine = require ("readline");
var cluster = require ("cluster");

ep.create (ep.next (), "GRACE_START",
		"Cannot start the graceful application more than one time");

var WIN = process.platform === "win32";

var GRACE_DISCONNECT = "GRACE-before-disconnect";
var GRACE_DESTROY = "GRACE-before-destroy";

(function (){
	if (cluster.isMaster) return;
	
	//Captures the GRACE_DESTROY message
	var on = process.on;
	process.on = function (type, listener){
		if (type === "message"){
			on.call (process, type, function (msg){
				if (typeof msg === "object" && msg[GRACE_DESTROY]){
					//The master is going to destroy the worker, emit an exit event and
					//inform the master that now the worker can be killed
					process.emit ("exit");
					process.send (msg);
					process.on = on;
				}else{
					listener (msg);
				}
			});
		}else{
			on.apply (process, arguments);
		}
	};
	
	//At least one listener must be configured in order to listen messages
	process.on ("message", function (){});
})();

var grace = module.exports = {};
var workersToDestroy = {};
var rl;

var cleanError = function (error){
	if (!(error instanceof Object)) return error;
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

grace.create = function (){
	return new Grace ();
};

var Grace = function (onStart){
	events.EventEmitter.call (this);
	this._domain = domain.create ();
	this._shutdown = false;
	this._started = false;
	this._timeout = null;
	this._disconnectCallback = null;
	this._exitCode = null;
	this._hasWorkers = false;
	this._defaultErrorHandlerCalled = false;
};

util.inherits (Grace, events.EventEmitter);

Grace.prototype._masterExit = function (code){
	if (cluster.isWorker) return;
	
	var me = this;
	
	if (this._exitCode !== undefined && this._exitCode !== null){
		code = this._exitCode;
	}
	
	if (WIN && cluster.isMaster){
		//If shutdown() is called from the master then stop reading the stdin
		rl.close ();
	}
	
	var exit = function (){
		me.emit ("exit", code);
		if (WIN && me._ctrlc) process.stdout.write ("^C");
		process.reallyExit (code);
	};

	if (this._hasWorkers){
		//If the master has had workers cannot just call to process.exit() because
		//there can be exit events that need to execute, e.g. cluster or worker
		//exit event
		process.on ("exit", function (){
			exit ();
		});
	}else{
		exit ();
	}
};

Grace.prototype._workerExit = function (code){
	if (cluster.isMaster) return;
	
	var me = this;
	
	if (this._exitCode !== undefined && this._exitCode !== null){
		code = this._exitCode;
	}
	
	process.on ("exit", function (){
		me.emit ("exit", code);
		process.reallyExit (code);
	});
	
	if (!this._disconnectCallback){
		//shutdown() was called directly on the worker, call to destroy()
		cluster.worker.destroy ();
	}else{
		//Call to the original disconnect and try to gracefully shutdown
		this._disconnectCallback ();
	}
};

Grace.prototype._overrideDestroy = function (){
	if (cluster.isWorker) return;
	var me = this;
	
	//When destroy is called from the master the exit code of the worker is always
	//null and the signal is SIGTERM, it can be hacked and fixed with a 0
	//If a signal is sent by other ways -like sending a SIGINT signal- the exit
	//code is not modified
	//Furthermore, when the master destroys a worker, the worker doesn't fire an
	//exit event or SIGTERM event (https://github.com/joyent/node/issues/4823), so
	//in order to fire an exit event to the user a custom message has to be sent
	//to the worker to emit a manual exit event before calling destroy from the
	//master
	
	var destroy = cluster.Worker.prototype.destroy;
	cluster.Worker.prototype.destroy = function (){
		var code = me._workerExitCode !== null ? me._workerExitCode : 0;
		var onexit = this.process._handle.onexit;
		var p = this.process;
		
		this.process._handle.onexit = function (exitCode, signalCode){
			//If signal code is not null the exitCode is always ignored, so if destroy
			//is overrided and signalCode is not null then it is safe to consider
			//that the signalCode is always SIGTERM, sanity check
			if (signalCode === "SIGTERM"){
				//If onexit is called then the worker is already dead (with exitCode 1)
				//so the exit code will never change anymore, let's consider no error
				p.exitCode = code;
			}
			onexit.call (undefined, exitCode, signalCode);
		};
		
		var o = {};
		o[GRACE_DESTROY] = this.id + "";
		this.on ("message", function (msg){
			if (typeof msg === "object" && msg[GRACE_DESTROY] !== undefined){
				//The worker confirms that it can be destroyed
				for (var id in workersToDestroy){
					if (id === msg[GRACE_DESTROY]){
						destroy.call (workersToDestroy[id]);
						delete workersToDestroy[id];
						break;
					}
				}
			}
		});
		//Save the worker to destroy it later
		workersToDestroy[this.id + ""] = this;
		this.send (o);
	};
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
		this.emit (GRACE_DISCONNECT, function (){
			disconnect.call (worker);
		});
	};
	
	cluster.worker.on (GRACE_DISCONNECT, function (cb){
		//Save disconnect callback to call it when the shutdown task finishes
		me._disconnectCallback = cb;
		me.shutdown ();
	});
};

Grace.prototype._emitError = function (error, req, res){
	//Express try-catches every middleware
	//When a user's middleware throws an exception the request error handler is
	//called. If this handler throws or it simply falls back to the default error
	//handler and it throws again, that is, exceptions that are thrown in the
	//default error handler, Express try-catches them and the program is still
	//alive when it should be killed by design
	//Therefore, try-catch the default error handler, print the stack and exit
	error = cleanError (error);
	try{
		if (req){
			this.emit.call (this, "error", error, req, res);
		}else{
			this.emit.call (this, "error", error);
		}
	}catch (e){
		process.stderr.write ((e.stack || new Error (e).stack) + "\n");
		process.exit (1);
	}
};

Grace.prototype._callErrorHandler = function (error, req, res, cb){
	//If this function is called more than one that means that an asynchronous
	//exception has been thrown inside the request error handler and generates
	//infinite recursive calls, e.g.:
	//errorHandler (function (error, req, res, preventDefault){
	//	process.nextTick (function (){ null.killer });
	//});
	//Break recursion and fall back to the default error handler
	if (this._defaultErrorHandlerCalled){console.log(9)
		this._emitError.call (this, req, res);
		req._grace.requestDomain.exit ();
		return;
	}
	this._defaultErrorHandlerCalled = true;

	//Tries to call to the request error handler and falls back to the default
	//error handler
	
	error = cleanError (error);
	
	var emitDefault = true;
	var preventDefault = function (){
		emitDefault = false;
	};
	
	if (cb){
		//Synchronous exceptions are catched and redirected to the default error
		//handler
		//Ignores preventDefault
		try{
			cb.call (undefined, error, req, res, preventDefault);
		}catch (e){
			this._emitError.call (this, error, req, res);
			req._grace.requestDomain.exit ();
			return;
		}
	}
	if (emitDefault){
		this._emitError.call (this, error, req, res);
	}
};

Grace.prototype.dom = function (req){
	return req instanceof http.IncomingMessage
			? req._grace.requestDomain
			: this._domain;
};

//Express middleware for handling uncaught exceptions thrown by a request
Grace.prototype.errorHandler = function (cb){
	var me = this;
	return function (req, res, next){
		//The domain is destroyed when the request ends
		//https://groups.google.com/forum/?fromgroups=#!topic/nodejs/WMR7d-PyH74
		var d = domain.create ();
		req._grace = {
			errorHandler: cb,
			requestDomain: d
		};
		d.add (req);
		d.add (res);
		d.on ("error", function (error){
			res.on ("close", function (){
				//Response fails before sending data
				//dispose() hangs up everything
				//https://groups.google.com/forum/?fromgroups=#!topic/nodejs/UCqbgxI8gRw
				d.exit ();
			});
			
			me._callErrorHandler (error, req, res, cb);
		});
		d.run (function (){
			next ();
		});
	};
};

Grace.prototype.redirectError = function (error, req, res){
	//Normal use
	//e.use (function (error, req, res, next){
	//	g.redirectError (error, req, res);
	//});
	if (arguments.length === 3){
		this._callErrorHandler (error, req, res, req._grace.errorHandler);
		return;
	}
	
	//Express shorthand
	//e.use (g.redirectError ());
	var me = this;
	return function (error, req, res, next){
		me._callErrorHandler (error, req, res, req._grace.errorHandler);
	};
};

Grace.prototype.start = function (){
	if (this._started) throw ep.get ("GRACE_START");
	this._started = true;
	
	this._overrideDisconnect ();
	this._overrideDestroy ();
	
	var me = this;
	
	var onStart = this.listeners ("start");
	onStart = onStart.length ? onStart[0] : null;
	if (!onStart) return this.shutdown ();
	
	this._domain.on ("error", function (error){
		//Thrown exceptions in the error listener exits the process, be careful
		me._emitError (error);
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
		
		if (cluster.isMaster){	
			//When all the workers die shutdown the master after all the exit events
			//are emitted
			cluster.on ("exit", function (){
				if (!Object.keys (cluster.workers).length){
					process.nextTick (function (){
						me.shutdown ();
					});
				}
			});
		}
	}catch (error){
		//If an exception occurs during synchronous initialization, emit error
		//and shutdown
		this._emitError (error);
		this.shutdown (1);
	}
	
	//Cannot listen to the "exit" event because it's not possible to add
	//asynchronous tasks
	process.on ("SIGINT", function (){
		me._ctrlc = true;
		me.shutdown ();
	});
};

Grace.prototype.shutdown = function (code){
	if (this._shutdown) return;
	this._shutdown = true;
	
	if (cluster.isMaster){
		this._hasWorkers = !!Object.keys (cluster.workers).length;
	}
	
	this._exitCode = code;
	var me = this;
	
	var onShutdown = this.listeners ("shutdown");
	onShutdown = onShutdown.length ? onShutdown[0] : null;
	if (!onShutdown){
		return cluster.isMaster ? this._masterExit (0) : this._workerExit (0);
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
	var syncShutError;
	
	var force = function (){
		if (cluster.isMaster){
			//Force shutdown and destroy all the remaining workers, if any
			//Child processes will be automatically destroyed when the master exits
			forced = true;
			
			me._workerExitCode = 1;
			
			var remaining = Object.keys (cluster.workers).length;
			if (!remaining) return me._masterExit (1);
			eachWorker (function (worker){
				worker.on ("exit", function (code){
					if (!--remaining){
						me._masterExit (1);
					}
				});
				worker.destroy ();
			});
		}else{
			me._workerExit (1);
		}
	};
	
	if (this._timeout){
		timer.set (force);
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
					me._emitError (error);
					cluster.isMaster ? me._masterExit (1) : me._workerExit (1);
				}else{
					cluster.isMaster ? me._masterExit (0) : me._workerExit (0);
				}
			});
		}catch (error){
			if (me._exitCode === undefined || me._exitCode === null){
				me._exitCode = 1;
			}
			me._emitError (error);
		}
	});
};

Grace.prototype.timeout = function (ms, cb){
	this._timeout = {
		ms: ms,
		cb: cb
	};
};