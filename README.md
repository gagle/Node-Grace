graceful-shut
=============

_Node.js project_

## Warning
Because it's pretty hard to write concurrent code, treat with the master and the workers, overriding source code, supporting Windows and Linux and writing a transparent API, this module is in a beta state until it reaches v1.0.0.

It's working pretty well with the provided examples and is actively tested in edge cases. If you find a bug, please report it.
***

#### Graceful shutdown with domains and cluster support ####

Version: 0.1.3

Provides an event-based mechanism to start and gracefully shutdown a Node.js process when a SIGINT signal is sent to it. Because Windows doesn't have POSIX signals a different method has to be used (reading the stdin for a ctrl-c key). The process can be gracefully killed pressing ctrl-c (Windows & Linux) and sending to it a SIGINT signal (Linux). It also uses domains so uncaught exceptions doesn't kill the process. Furthermore, if you use workers, the shutdown task takes care about that and transparently manages them in order to always guarantee a graceful shutdown providing to the user a last opportunity to clean up tasks asynchronously.

If the process finishes correctly the exit code is 0, otherwise 1. The process can also exit with a custom code.

#### Installation ####

```
npm install graceful-shut
```

#### Example ####

```javascript
var gs = require ("graceful-shut");

var app = gs.create ();

app.on ("error", function (error){
	//Unhandled and redirected errors
	console.error (error);
});

app.on ("start", function (){
	//On Windows shutdown() must be called in order to call the shutdown listener
	//and exit. On Linux is not needed to finish the process but the shutdown
	//listener won't be called. Therefore, if you want to always call the shutdown
	//listener, always call to shutdown().
	app.shutdown ();
});

app.on ("shutdown", function (cb){
	//Clean up tasks
	cb ();
});

app.on ("exit", function (code){
	console.log ("bye (" + code + ")");
});

app.timeout (1000, function (cb){
	//The timeout is used if the shutdown task takes more time than expected
	//The callback must be always called 
	console.error ("forced shutdown!");
	cb ();
});

app.start ();
```

#### Methods and Properties ####

Take a look at the [examples](https://github.com/Gagle/Node-GracefulShut/blob/master/examples) to fully understand how to use a "graceful application" -especially with clusters-. Once you feel comfortable with it you probably will never stop using it.

- [gs.create()](#create)
- [Grace#dom()](#dom)
- [Grace#shutdown([exitCode])](#shutdown)
- [Grace#start()](#start)
- [Grace#timeout(ms[, callback])](#timeout)

<a name="create"></a>
__gs.create()__  
Creates a "graceful application" that emits `error`, `start` and `shutdown` events. Only one "graceful application" can be created per Node.js process.

<a name="dom"></a>
__Grace#dom()__  
Returns the domain used internally that is listenig for errors. Useful when you want to use [Domain#intercept()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domaininterceptcallback) or [Domain#bind()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domainbindcallback) to redirect errors to the internal domain.

<a name="shutdown"></a>
__Grace#shutdown([exitCode])__  
Programatically shutdowns the Node.js process. The listener attached to the `shutdown` event will be called before shutting down the process. On Windows this function must be called in order to shutdown the process even if there's no pending events in the event loop queue because the process is continuously reading the stdin. On Linux it's not needed to call it when the event loop is emty because the process automatically finishes, but the shutdown listener is not called, so for compatibility and reusability of the same code on different platforms it's recommended to always call to `shutdown()` both on Windows and Linux when you want exit.

Calling to `process.exit()` will exit your application without calling the shutdown listener. Use it if you want to exit immediately but I recommend to always call to the `shutdown()` function and set a timeout to give an opportunity to gracefully shutdown before forcing the exit. So, if you want to exit, use `Grace#shutdown()` instead of `process.exit()`.

If you use workers they're managed for you so you don't need to worry if a worker hangs up when shutting down the server (probably by one or more active long living connections), just set a timeout and it will be killed.

The listener runs inside a domain. Unhandled exceptions will be handled by the `error` event.

<a name="start"></a>
__Grace#start()__  
Starts the "graceful application". The listener runs inside a domain. Unhandled exceptions will be handled by the `error` event. The only exceptions that can kill the process  when the server is up and listening for new connections are those that are produced synchronously at compile-time when initializing the server. These errors are not considered "pure uncaught exceptions", they're produced during the server initialization. Therefore, uncaught exceptions thrown by a user request will never kill the entire server, that's for sure.

<a name="timeout"></a>
__Grace#timeout(ms[, callback])__  
Adds a timeout in milliseconds to wait before forcing the exit the shutdown task takes more than expected. By default there's no timeout so the master/workers can hang up and there won't be any way to finish the process, you'll need to send a SIGINT signal or press ctrl-c. It's strongly recommended to always configure a timeout.

An optional callback can be passed. It will be executed when the exit has been forced. The callback receives a function that must be executed to completely finish the process. This callback it's only for informational purposes like printing to console. It's up to you if you do any asynchronous calls like sending an email to the administrator or whatever, but make sure to <span style="text-decoration: underline">__always__</span> call the on completion callback or the process will never end.

#### Events ####

- [error](#event-error)
- [exit](#event-exit)
- [shutdown](#event-shutdown)
- [start](#event-start)

<a name="event-error"></a>
__error__  
Emitted when an unhandled exception has been thrown or has been redirected to the domain with [Domain#intercept()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domaininterceptcallback) or [Domain#bind()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domainbindcallback). Exceptions thrown inside this listener will kill the process, be careful.

<a name="event-exit"></a>
__exit__  
Emitted when the process is going to die. The event loop doesn't work at this point so asynchronous tasks won't work. Tipically used to print something in console. The exit code is passed as a parameter.

<a name="event-shutdown"></a>
__shutdown__  
Emitted when the Node.js process is going to finalize. This is the last chance to gracefully shutdown the process so this is the place to close any open resources like database connections, flush buffered data to disk, etc. A callback is passed to the listener to call it when all the clean up tasks are done, call it or the process will hang up. You can also pass an error to the callback and it will be emitted back again and redirected to the `error` event listener. This event is fired in 2 circumstances:

- Ctrl-c key or SIGINT signal is received. On Windows only the master process can receive a SIGINT (from a ctrl-c). If the master receives a ctrl-c/SIGINT and it uses workers, they will receive a `shutdown` event so they will be automatically finished.
- `Grace#shutdown()` is called. If it's called on the master and you use workers all of them will receive a `shutdown` event and will be disconnected. If you call to `shutdown()` directly from a worker it will be destroyed.

Is also possible to directly call to `disconnect()` and `destroy()` in a worker. If you call to `disconnect` the `shutdown` event will be fired and if you call to `destroy()` it will be directly killed without firing a `shutdown` event and the "graceful application" will be informed about this in order to correctly manage the remaining workers.

<a name="event-start"></a>
__start__  
Emitted right after the `start()` function is called.