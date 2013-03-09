grace
=====

_Node.js project_

## Warning
Because it's pretty hard to write concurrent code, treat with the master and the workers, overriding source code, supporting Windows, Linux and Express and writing a transparent API, this module is in a beta state until it reaches v1.0.0.

It's working pretty well with the provided examples and is actively tested in edge cases. If you find a bug, please report it.
***

#### Graceful application with domains, cluster, error handling and Express support ####

Version: 0.2.2

Provides an event-based mechanism to start and gracefully shutdown a web server.

When a SIGINT signal is sent to it (on Windows the stdin is read for a ctrl-c key). The server can be gracefully killed pressing ctrl-c (Windows and Linux) and sending a SIGINT signal (Linux).

It also uses domains (global and per request domains), therefore uncaught exceptions doesn't kill the server, absolutely never.

Furthermore, if you use workers, the shutdown task takes care of them and transparently manages them in order to always guarantee a graceful shutdown giving to the user a last opportunity to clean up resources.

The Express web framework is fully supported. It can also be used without Express but it's not recommended.

If the process finishes correctly the exit code is 0, otherwise 1. The process can also exit with a custom code.

#### Installation ####

```
npm install grace
```

#### Example ####

```javascript
var grace = require ("grace");

var app = grace.create ();

app.on ("error", function (error){
	//Unhandled and redirected errors
	console.error (error);
});

app.on ("start", function (){
	//On Windows shutdown() must be called in order to call the shutdown listener
	//and exit. On Linux is not needed but the shutdown listener won't be called.
	//Therefore, if you want to always finish gracefully, call to shutdown().
	app.shutdown ();
});

app.on ("shutdown", function (cb){
	//Clean up tasks
	console.log ("shutting down");
	//Comment this line and the timeout will do its job
	cb ();
});

app.on ("exit", function (code){
	console.log ("bye (" + code + ")");
});

app.timeout (1000, function (cb){
	//The timeout is used if the shutdown task takes more time than expected
	console.error ("timed out, forcing shutdown");
	cb ();
});

app.start ();
```

#### Methods and Properties ####

Take a look at the [examples](https://github.com/Gagle/Node-Grace/blob/master/examples) to fully understand how to use a "graceful application" -especially with workers and Express-. Once you feel comfortable with it you probably will never stop using it because it provides the base of a robust web server.

- [gs.create()](#create)
- [Grace#dom([request])](#dom)
- [Grace#errorHandler([callback])](#errorHandler)
- [Grace#redirectError([error[, request, response]])](#redirectError)
- [Grace#shutdown([exitCode])](#shutdown)
- [Grace#start()](#start)
- [Grace#timeout(ms[, callback])](#timeout)

<a name="create"></a>
__gs.create()__  
Creates a "graceful application" that emits `error`, `start` and `shutdown` events. Only one "graceful application" can be created per Node.js process.

<a name="dom"></a>
__Grace#dom([request])__  
Returns the domain used internally that is listenig for errors. Useful when you want to use [Domain#intercept()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domaininterceptcallback) or [Domain#bind()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domainbindcallback) to redirect errors to the internal domain.

If no parameters are passed it returns the default domain. If the request is passed it returns the request domain, otherwise it returns `null`.

If you are initializing the server (running the code before the http server starts listening a socket) you can use `dom().intercept()` to redirect errors to the default error handler. If you are serving a request you can redirect to the request error handler with `dom(req).intercept()`. If you don't call to `preventDefault` inside the request error handler, the error is redirected automatically to the default error handler, therefore you can have a single point where all the errors are redirected, the default error handler:

```javascript
app.on ("error", function (error){
	//This is the only place where you can log fatal errors
	log.fatal (error);
});
```

<a name="errorHandler"></a>
__Grace#errorHandler([callback])__  
Used with Express. This should be the very first middleware. Its purpose is to create a per request domain. All the errors produced during a request will catched by this middleware. When this happens the callback is called and 4 parameters are passed: the error, request, response and a function named `preventDefault`. By design the request errors are redirected to the default error handler -the listener attached to the `error` event-. If `preventDefault()` is called the request error won't be redirected.

Usually, the request error handler sends a 500 error and the default error handler logs the error with the highest priority. This means that you can have only 1 function in all the web server that logs fatal errors!

```javascript
ex.use (g.errorHandler (function (error, req, res, preventDefault){
	res.send (500);
}));
```

You can also use this function without Express to create per request domains but definitely is not the right way to go. See the [server](https://github.com/Gagle/Node-Grace/blob/master/examples/server.js) example.

<a name="redirectError"></a>
__Grace#redirectError([error[, request, response]])__  
Redirects an error to an error handler. It redirects to the default or request error handler depending on the number of parameters.

- 0 parameters.  
  Express -or any frameworks express-like- is required. It's a shorthand to use the Express error handler.

  ```javascript
  //Express error handler, last middleware
  ex.use (g.redirectError ());
  ```

- 1 parameter: error.  
  Redirects to the default error handler. Useful when you need to do something before redirecting to the default error handler.

	```javascript
	//This redirects errors to the default error handler but you can't do anything before redirecting
	asyncFUnction (g.dom ().intercept ());
	
	//Solution, use redirectError()
	asyncFunction (function (error){
		doSomething ();
		g.redirectError (error);
	});
	```
	
- 3 parameters: error, request, response.  
  Redirects to the request error handler and falls back to the default error handler if `preventDefault()` is not called. Useful when you need to do something before redirecting to the request error handler. It can be used inside the Express error handler.

  ```javascript
  //Express error handler, last middleware
  ex.use (function (error, req, res, next){
		g.redirectError (error, req, res);
	});
  ```

<a name="shutdown"></a>
__Grace#shutdown([exitCode])__  
Programatically shutdowns the Node.js process. The listener attached to the `shutdown` event will be called before shutting down the process. On Windows this function must be called in order to shutdown the process even if there's no pending callbacks in the event loop queue because the process is continuously reading the stdin. On Linux it's not needed to call it when the event loop is emty because the process automatically finishes, but the shutdown listener won't be called, so for compatibility and reusability of the same code on different platforms it's recommended to always call to `shutdown()` both on Windows and Linux when you want exit.

Calling to `process.exit()` will exit your application without calling the shutdown listener. Use it if you want to exit immediately but I recommend to always call to the `shutdown()` function and set a timeout to give an opportunity to gracefully shutdown before forcing the exit. So, if you want to exit, use `Grace#shutdown()` instead of `process.exit()`.

If you use workers they're managed for you so you don't need to worry if a worker hangs up when shutting down the server (probably by one or more active long living connections), just set a timeout and it will be killed.

The listener runs inside a domain. Unhandled exceptions will be handled by the `error` event listener.

<a name="start"></a>
__Grace#start()__  
Starts the "graceful application" emitting a `start` event. The listener runs inside a domain. Unhandled exceptions will be handled by the `error` event listener. The only errors that can kill the process when the server is up and listening for new connections are those that are produced synchronously at compile-time when initializing the server and those that occurs inside the `error` event listener. These errors are not considered "pure uncaught exceptions". Therefore, uncaught exceptions thrown by a request will never kill the entire server, that's for sure.

<a name="timeout"></a>
__Grace#timeout(ms[, callback])__  
Adds a timeout in milliseconds to wait before forcing the exit when the shutdown task takes more than expected. By default there's no timeout so the master/workers can hang up and won't be any way to gracefully finish the process. It's strongly recommended to always configure a timeout.

An optional callback can be passed. It will be executed when the timeout expires, before forcing the exit. The callback receives a function that must be called to completely finish the process. This callback it's only for informational purposes like printing to console. It's up to you if you do any asynchronous calls like sending an email to the administrator or whatever, but make sure to <span style="text-decoration: underline">__always__</span> call the callback or the process will never end.

#### Events ####

- [error](#event-error)
- [exit](#event-exit)
- [shutdown](#event-shutdown)
- [start](#event-start)

<a name="event-error"></a>
__error__  
Emitted when an unhandled exception has been thrown or has been redirected to the domain with [Domain#intercept()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domaininterceptcallback) or [Domain#bind()](https://github.com/joyent/node/blob/master/doc/api/domain.markdown#domainbindcallback). Exceptions thrown inside the listener will kill the process, be careful.

<a name="event-exit"></a>
__exit__  
Emitted when the process is going to die. The event loop doesn't work at this point so asynchronous tasks won't work. Tipically used to print something to the console. The exit code is passed as parameter.

<a name="event-shutdown"></a>
__shutdown__  
Emitted when the Node.js process is going to shutdown. This is the last chance to gracefully shutdown the process so this is the place to close any open resources like database connections, flush buffered data to disk, etc. A callback is passed to the listener to call it when all the clean up tasks have been done. Call it or the process will hang up. You can also pass an error to the callback and it will be emitted back again and redirected to the `error` event listener. This event is fired in 3 circumstances:

- Ctrl-c key or SIGINT signal is received. On Windows only the master process can receive a SIGINT (from a ctrl-c). If the master receives a ctrl-c/SIGINT and it uses workers, they will receive a `shutdown` event so they will be automatically finished.
- `Grace#shutdown()` is called. If it's called on the master and you use workers all of them will receive a `shutdown` event and will be disconnected. If you call to `shutdown()` directly from a worker it will be destroyed.
- When all the workers die the `shutdown` event is fired automatically in the master.

It's also possible to directly call to `disconnect()` and `destroy()` in a worker. If you call to `disconnect` the `shutdown` event will be fired and if you call to `destroy()` it will be directly killed without firing a `shutdown` event.

<a name="event-start"></a>
__start__  
Emitted right after the `start()` function is called.
