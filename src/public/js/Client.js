/*
 * Copyright (c) 2013-2017 Antoine Martin <antoine@devloop.org.uk>
 * Copyright (c) 2016 David Brushinski <dbrushinski@spikes.com>
 * Copyright (c) 2014 Joshua Higgins <josh@kxes.net>
 * Copyright (c) 2015-2016 Spikes, Inc.
 * Licensed under MPL 2.0
 *
 * xpra client
 *
 * requires:
 *	Protocol.js
 *	Window.js
 *	Keycodes.js
 */

"use strict";

var XPRA_CLIENT_FORCE_NO_WORKER = false;

function XpraClient(container) {
	// the container div is the "screen" on the HTML page where we
	// are able to draw our windows in.
	this.container = document.getElementById(container);
	if (!this.container) {
		throw "invalid container element";
	}
	// assign callback for window resize event
	if (window.jQuery) {
		var me = this;
		jQuery(window).resize(jQuery.debounce(250, function (e) {
			me._screen_resized(e, me);
		}));
	}

	this.protocol = null;

	this.init_settings();
	this.init_state();
}

XpraClient.prototype.init_settings = function(container) {
	//server:
	this.host = null;
	this.port = null;
	this.ssl = null;
	this.path = "";
	this.username = "";
	this.password = null;
	this.insecure = false;
	//connection options:
	this.sharing = false;
	this.open_url = true;
	this.steal = true;
	this.remote_logging = true;
	this.enabled_encodings = [];
	this.supported_encodings = ["jpeg", "png", "rgb", "rgb32"];	//"h264", "vp8+webm", "h264+mp4", "mpeg4+mp4"];
	if (Utilities.canUseWebP()) {
		this.supported_encodings.push("webp");
	}
	this.debug_categories = [];
	this.start_new_session = null;
	this.clipboard_enabled = false;
	this.file_transfer = false;
	this.keyboard_layout = null;
	this.printing = false;
	this.bandwidth_limit = 0;
	this.reconnect = true;
	this.reconnect_count = 5;
	this.reconnect_in_progress = false;
	this.reconnect_delay = 1000;	//wait 1 second before retrying
	this.reconnect_attempt = 0;
	this.swap_keys = Utilities.isMacOS();
	this.HELLO_TIMEOUT = 10000;
	this.PING_TIMEOUT = 15000;
	this.PING_GRACE = 2000;
	this.PING_FREQUENCY = 5000;
	this.uuid = Utilities.getHexUUID();
}

XpraClient.prototype.init_state = function(container) {
	// state
	this.desktop_width = 0;
	this.desktop_height = 0;
	this.server_remote_logging = false;
	// some client stuff
	this.capabilities = {};
	this.RGB_FORMATS = ["RGBX", "RGBA"];
	this.disconnect_reason = null;
	// audio
	this.audio_enabled = false;
	this.audio_mediasource_enabled = MediaSourceUtil.getMediaSourceClass()!=null;
	this.audio_aurora_enabled = typeof AV!=='undefined' && AV!=null && AV.Decoder!=null && AV.Player.fromXpraSource!=null;
	this.audio_httpstream_enabled = true;
	this.audio_codecs = {};
	this.audio_framework = null;
	this.audio_aurora_ctx = null;
	this.audio_codec = null;
	this.audio_context = Utilities.getAudioContext();
	this.aurora_codecs = {};
	this.mediasource_codecs = {};
	// encryption
	this.encryption = false;
	this.encryption_key = null;
	this.cipher_in_caps = null;
	this.cipher_out_caps = null;
	// detect locale change:
	this.browser_language = Utilities.getFirstBrowserLanguage();
	this.browser_language_change_embargo_time = 0;
	this.key_layout = null;
	// mouse
	this.mousedown_event = null;
	this.last_mouse_x = null;
	this.last_mouse_y = null;
	this.wheel_delta_x = 0;
	this.wheel_delta_y = 0;
	// clipboard
	this.clipboard_buffer = "";
	this.clipboard_pending = false;
	this.clipboard_targets = ["UTF8_STRING", "TEXT", "STRING", "text/plain"];
	// printing / file-transfer:
	this.remote_printing = false;
	this.remote_file_transfer = false;
	this.remote_open_files = false;
	// hello
	this.hello_timer = null;
	// ping
	this.ping_timeout_timer = null;
	this.ping_grace_timer = null;
	this.ping_timer = null;
	this.last_ping_server_time = 0
	this.last_ping_local_time = 0
	this.last_ping_echoed_time = 0;
	this.server_ok = false;
    //packet handling
    this.queue_draw_packets = false;
    this.dQ = [];
    this.dQ_interval_id = null;
    this.process_interval = 4;

    this.server_resize_exact = false;
    this.server_screen_sizes = [];
    this.server_is_desktop = false;

    this.server_connection_data = false;

	// a list of our windows
	this.id_to_window = {};
	this.ui_events = 0;
	this.pending_redraw = [];
	this.draw_pending = 0;
	// basic window management
	this.topwindow = null;
	this.topindex = 0;
	this.focus = -1;

	jQuery("#screen").mousedown(function (e) {
		me.on_mousedown(e);
	});
	jQuery("#screen").mouseup(function (e) {
		me.on_mouseup(e);
	});
	jQuery("#screen").mousemove(function (e) {
		me.on_mousemove(e);
	});
	var me = this;
	var div = document.getElementById("screen");
	function on_mousescroll(e) {
		me.on_mousescroll(e);
	}
	if (Utilities.isEventSupported("wheel")) {
		div.addEventListener('wheel',			on_mousescroll, false);
	}
	else if (Utilities.isEventSupported("mousewheel")) {
		div.addEventListener('mousewheel',		on_mousescroll, false);
	}
	else if (Utilities.isEventSupported("DOMMouseScroll")) {
		div.addEventListener('DOMMouseScroll',	on_mousescroll, false); // for Firefox
	}
}

XpraClient.prototype.send = function() {
	if (this.protocol) {
		this.protocol.send.apply(this.protocol, arguments);
	}
}

XpraClient.prototype.send_log = function(level, args) {
	if(this.remote_logging && this.server_remote_logging) {
		try {
			var sargs = [];
			for(var i = 0; i < args.length; i++) {
				sargs.push(String(args[i]));
			}
			this.send(["logging", level, sargs]);
		} catch (e) {
			console.error("remote logging failed: "+e);
			for(var i = 0; i < args.length; i++) {
				console.log(" argument", i, typeof args[i], ":", "'"+args[i]+"'");
			}
		}
	}
}
XpraClient.prototype.error = function() {
	//logging.ERROR = 40
	this.send_log(40, arguments);
	console.error.apply(console, arguments);
}
XpraClient.prototype.warn = function() {
	//logging.WARN = 30
	this.send_log(30, arguments);
	console.log.apply(console, arguments);
}
XpraClient.prototype.log = function() {
	//logging.INFO = 20
	this.send_log(20, arguments);
	console.log.apply(console, arguments);
}
XpraClient.prototype.debug = function() {
	var category = arguments[0];
	var args = Array.from(arguments);
	args = args.splice(1);
	if (this.debug_categories.includes(category)) {
		if (category!="network") {
			//logging.DEBUG = 10
			this.send_log(10, arguments);
		}
		console.debug.apply(console, args);
	}
}


XpraClient.prototype.init = function(ignore_blacklist) {
	this.on_connection_progress("Initializing", "", 20);
	this.init_audio(ignore_blacklist);
	this.init_packet_handlers();
	this.init_keyboard();
}


XpraClient.prototype.init_packet_handlers = function() {
	// the client holds a list of packet handlers
	this.packet_handlers = {
		'open': this._process_open,
		'close': this._process_close,
		'error': this._process_error,
		'disconnect': this._process_disconnect,
		'challenge': this._process_challenge,
		'startup-complete': this._process_startup_complete,
		'hello': this._process_hello,
		'ping': this._process_ping,
		'ping_echo': this._process_ping_echo,
		'new-tray': this._process_new_tray,
		'new-window': this._process_new_window,
		'new-override-redirect': this._process_new_override_redirect,
		'window-metadata': this._process_window_metadata,
		'lost-window': this._process_lost_window,
		'raise-window': this._process_raise_window,
		'window-icon': this._process_window_icon,
		'window-resized': this._process_window_resized,
		'window-move-resize': this._process_window_move_resize,
		'initiate-moveresize': this._process_initiate_moveresize,
		'configure-override-redirect': this._process_configure_override_redirect,
		'desktop_size': this._process_desktop_size,
		'eos': this._process_eos,
		'draw': this._process_draw,
		'cursor': this._process_cursor,
		'bell': this._process_bell,
		'notify_show' : this._process_notify_show,
		'notify_close' : this._process_notify_close,
		'sound-data': this._process_sound_data,
		'clipboard-token': this._process_clipboard_token,
		'set-clipboard-enabled': this._process_set_clipboard_enabled,
		'clipboard-request': this._process_clipboard_request,
		'send-file': this._process_send_file,
		'open-url': this._process_open_url,
	};
}

XpraClient.prototype.on_connection_progress = function(state, details, progress) {
	//can be overriden
	console.log(state, details);
}

XpraClient.prototype.callback_close = function(reason) {
	if (reason === undefined) {
		reason = "unknown reason";
	}
	console.log("connection closed: "+reason);
}

XpraClient.prototype.connect = function() {
	var details = this.host + ":" + this.port;
	if (this.path) {
		details += "/"+this.path;
	}
	if (this.ssl) {
		details += " with ssl";
	}
	this.on_connection_progress("Connecting to server", details, 40);
	// open the web socket, started it in a worker if available
	// check we have enough information for encryption
	if(this.encryption) {
		if((!this.encryption_key) || (this.encryption_key == "")) {
			this.callback_close("no key specified for encryption");
			return;
		}
	}
	// detect websocket in webworker support and degrade gracefully
	if(window.Worker) {
		console.log("we have webworker support");
		// spawn worker that checks for a websocket
		var me = this;
		var worker = new Worker('js/lib/wsworker_check.js');
		worker.addEventListener('message', function(e) {
			var data = e.data;
			switch (data['result']) {
			case true:
				// yey, we can use websocket in worker!
				console.log("we can use websocket in webworker");
				me._do_connect(true);
				break;
			case false:
				console.log("we can't use websocket in webworker, won't use webworkers");
				me._do_connect(false);
				break;
			default:
				console.log("client got unknown message from worker");
				me._do_connect(false);
			};
		}, false);
		// ask the worker to check for websocket support, when we receive a reply
		// through the eventlistener above, _do_connect() will finish the job
		worker.postMessage({'cmd': 'check'});
	} else {
		// no webworker support
		console.log("no webworker support at all.")
		me._do_connect(false);
	}
}

XpraClient.prototype._do_connect = function(with_worker) {
	if(with_worker && !(XPRA_CLIENT_FORCE_NO_WORKER)) {
		this.protocol = new XpraProtocolWorkerHost();
	} else {
		this.protocol = new XpraProtocol();
	}
	this.open_protocol();
}

XpraClient.prototype.open_protocol = function() {
	// set protocol to deliver packets to our packet router
	this.protocol.set_packet_handler(this._route_packet, this);
	// make uri
	var uri = "ws://";
	if (this.ssl)
		uri = "wss://";
	uri += this.host;
	uri += ":" + this.port;
	if (this.path) {
		uri += "/"+this.path;
	}
	// do open
	this.on_connection_progress("Opening WebSocket connection", uri, 60);
	this.protocol.open(uri);
}

XpraClient.prototype.close = function() {
	console.log("client closed");
	this.close_windows();
	this.clear_timers();
	this.close_audio();
	this.close_protocol();
}

XpraClient.prototype.request_refresh = function(wid) {
	this.send([
		"buffer-refresh", wid, 0, 100,
		{
			"refresh-now"    : true,
			"batch"          : {"reset" : true},
		},
		{},	//no client_properties
		])
}

XpraClient.prototype.redraw_windows = function() {
	for (var i in this.id_to_window) {
		var iwin = this.id_to_window[i];
		this.request_redraw(iwin);
	}
}

XpraClient.prototype.close_windows = function() {
	for (var i in this.id_to_window) {
		var iwin = this.id_to_window[i];
		iwin.destroy();
	}
}

XpraClient.prototype.close_protocol = function() {
	if (this.protocol) {
		this.protocol.close();
		this.protocol = null;
	}
}

XpraClient.prototype.clear_timers = function() {
	if (this.hello_timer) {
		clearTimeout(this.hello_timer);
		this.hello_timer = null;
	}
	if (this.ping_timer) {
		clearTimeout(this.ping_timer);
		this.ping_timer = null;
	}
	if (this.ping_timeout_timer) {
		clearTimeout(this.ping_timeout_timer);
		this.ping_timeout_timer = null;
	}
	if (this.ping_grace_timer) {
		clearTimeout(this.ping_grace_timer);
		this.ping_grace_timer = null;
	}
}

XpraClient.prototype.enable_encoding = function(encoding) {
	// add an encoding to our hello.encodings list
	console.log("enable",encoding);
	this.enabled_encodings.push(encoding);
}

XpraClient.prototype.disable_encoding = function(encoding) {
	// remove an encoding from our hello.encodings.core list
	// as if we don't support it
	console.log("disable",encoding);
	var index = this.supported_encodings.indexOf(encoding);
	if(index > -1) {
		this.supported_encodings.splice(index, 1);
	}
}

XpraClient.prototype._route_packet = function(packet, ctx) {
	// ctx refers to `this` because we came through a callback
	var packet_type = "";
	var fn = "";
	packet_type = packet[0];
	ctx.debug("network", "received a", packet_type, "packet");
	fn = ctx.packet_handlers[packet_type];
	if (fn==undefined) {
		console.error("no packet handler for "+packet_type+"!");
		console.log(packet);
	} else {
		fn(packet, ctx);
	}
}

XpraClient.prototype._screen_resized = function(event, ctx) {
	// send the desktop_size packet so server knows we changed size
	if (this.container.clientWidth==this.desktop_width && this.container.clientHeight==this.desktop_height) {
		return;
	}
	this.desktop_width = this.container.clientWidth;
	this.desktop_height = this.container.clientHeight;
	var newsize = [this.desktop_width, this.desktop_height];
	var packet = ["desktop_size", newsize[0], newsize[1], this._get_screen_sizes()];
	ctx.send(packet);
	// call the screen_resized function on all open windows
	for (var i in ctx.id_to_window) {
		var iwin = ctx.id_to_window[i];
		iwin.screen_resized();
	}
}

/**
 * Keyboard
 */
XpraClient.prototype.init_keyboard = function() {
	var me = this;
	// modifier keys:
	this.caps_lock = null;
	this.num_lock = true;
	this.num_lock_mod = null;
	this.alt_modifier = null;
	this.meta_modifier = null;
	// assign the keypress callbacks
	// if we detect jQuery, use that to assign them instead
	// to allow multiple clients on the same page
	document.addEventListener('keydown', function(e) {
		var r = me._keyb_onkeydown(e, me);
		if (!r) {
			e.preventDefault();
		}
	});
	document.addEventListener('keyup', function (e) {
		var r = me._keyb_onkeyup(e, me);
		if (!r) {
			e.preventDefault();
		}
	});
	document.addEventListener('keypress', function (e) {
		var r = me._keyb_onkeypress(e, me);
		if (!r) {
			e.preventDefault();
		}
	});
}

XpraClient.prototype._keyb_get_modifiers = function(event) {
	/**
	 * Returns the modifiers set for the current event.
	 * We get the list of modifiers using "get_event_modifiers"
	 * then we translate them.
	 */
	//convert generic modifiers "meta" and "alt" into their x11 name:
	var modifiers = get_event_modifiers(event);
	if (this.caps_lock)
		modifiers.push("lock");
	if (this.num_lock && this.num_lock_mod)
		modifiers.push(this.num_lock_mod);
	return this.translate_modifiers(modifiers);
}

XpraClient.prototype.translate_modifiers = function(modifiers) {
	/**
	 * We translate "alt" and "meta" into their keymap name.
	 * (usually "mod1")
	 * And also swap keys for macos clients.
	 */
	//convert generic modifiers "meta" and "alt" into their x11 name:
	//FIXME: look them up!
	var alt = "mod1";
	var meta = "mod1";
	var control = "control";
	//swap
	if (this.swap_keys) {
		meta = "control";
		control = "mod1";
	}
	var new_modifiers = modifiers.slice();
	var index = modifiers.indexOf("alt");
	if (index>=0)
		new_modifiers[index] = alt;
	index = modifiers.indexOf("meta");
	if (index>=0)
		new_modifiers[index] = meta;
	index = modifiers.indexOf("control");
	if (index>=0)
		new_modifiers[index] = control;
	//show("get_modifiers() modifiers="+modifiers.toSource());
	return new_modifiers;
}


XpraClient.prototype._check_browser_language = function(key_layout) {
	/**
	 * Use the "key_language" if we have it,
	 * otherwise use the browser's language.
	 * This function may ssend the new detected keyboard layout.
	 * (ignoring the keyboard_layout preference)
	 */
	var now = Utilities.monotonicTime();
	if (now<this.browser_language_change_embargo_time) {
		return;
	}
	var new_layout = null;
	if (key_layout && this.key_layout!=key_layout) {
		console.log("input language changed from", this.key_layout, "to", key_layout);
		new_layout = key_layout;
		this.key_layout = key_layout;
	}
	else {
		var l = Utilities.getFirstBrowserLanguage();
		if (l && this.browser_language != l) {
			new_layout = Utilities.getKeyboardLayout();
			console.log("browser language changed from", this.browser_language, "to", l, ", sending new keyboard layout:", layout);
			this.browser_language = l;
		}
	}
	if (new_layout!=null) {
		this.send(["layout-changed", new_layout, ""]);
		//changing the language too quickly can cause problems server side,
		//wait at least 2 seconds before checking again:
		this.browser_language_change_embargo_time = now + 2000;
	}
	else {
		//check again after 100ms minimum
		this.browser_language_change_embargo_time = now + 100;
	}
}


XpraClient.prototype._keyb_process = function(pressed, event) {
	/**
	 * Process a key event: key pressed or key released.
	 * Figure out the keycode, keyname, modifiers, etc
	 * And send the event to the server.
	 */
	// MSIE hack
	if (window.event)
		event = window.event;

	var keyname = event.code || "";
	var keycode = event.which || event.keyCode;
	if (keycode==229) {
		//this usually fires when we have received the event via "oninput" already
		return;
	}
	var str = event.key || String.fromCharCode(keycode);

	this.debug("keyboard", "processKeyEvent(", pressed, ", ", event, ") key=", keyname, "keycode=", keycode);

	//sync numlock
	if (keycode==144 && pressed) {
		this.num_lock = !this.num_lock;
	}

	var key_language = null;
	//special case for numpad,
	//try to distinguish arrowpad and numpad:
	//(for arrowpad, keyname==str)
	if (keyname!=str && str in NUMPAD_TO_NAME) {
		keyname = NUMPAD_TO_NAME[str];
		this.num_lock = ("0123456789.".indexOf(keyname))>=0;
	}
	//some special keys are better mapped by name:
	else if (keyname in KEY_TO_NAME){
		keyname = KEY_TO_NAME[keyname];
	}
	//next try mapping the actual character
	else if (str in CHAR_TO_NAME) {
		keyname = CHAR_TO_NAME[str];
		if (keyname.indexOf("_")>0) {
			//ie: Thai_dochada
			var lang = keyname.split("_")[0];
			key_language = KEYSYM_TO_LAYOUT[lang];
		}
	}
	//fallback to keycode map:
	else if (keycode in CHARCODE_TO_NAME) {
		keyname = CHARCODE_TO_NAME[keycode];
	}

	this._check_browser_language(key_language);

	//if (this.num_lock && keycode>=96 && keycode<106)
	//	keyname = "KP_"+(keycode-96);
	var DOM_KEY_LOCATION_RIGHT = 2;
	if (keyname.match("_L$") && event.location==DOM_KEY_LOCATION_RIGHT)
		keyname = keyname.replace("_L", "_R")

	var raw_modifiers = get_event_modifiers(event);
	var modifiers = this.translate_modifiers(raw_modifiers);
	var keyval = keycode;
	var group = 0;

	var shift = modifiers.indexOf("shift")>=0;
	if ((this.caps_lock && shift) || (!this.caps_lock && !shift))
		str = str.toLowerCase();

	var ostr = str;
	if (this.swap_keys) {
		if (keyname=="Control_L") {
			keyname = "Meta_L";
			str = "meta";
		}
		else if (keyname=="Meta_L") {
			keyname = "Control_L";
			str = "control";
		}
		else if (keyname=="Control_R") {
			keyname = "Meta_R";
			str = "meta";
		}
		else if (keyname=="Meta_R") {
			keyname = "Control_R";
			str = "control";
		}
	}

	if (this.topwindow != null) {
		//send via a timer so we get a chance to capture the clipboard value,
		//before we send control-V to the server:
		var packet = ["key-action", this.topwindow, keyname, pressed, modifiers, keyval, str, keycode, group];
		var me = this;
		setTimeout(function () {
			me.send(packet);
			me.debug("keyboard", packet);
			if (pressed && me.swap_keys && raw_modifiers.indexOf("meta")>=0 && ostr!="meta") {
				//macos will swallow the key release event if the meta modifier is pressed,
				//so simulate one immediately:
				packet = ["key-action", me.topwindow, keyname, false, modifiers, keyval, str, keycode, group];
				me.debug("keyboard", packet);
				me.send(packet);
			}
		}, 0);
	}
	if (this.clipboard_enabled) {
		//allow some key events that need to be seen by the browser
		//for handling the clipboard:
		var clipboard_modifier_keys = ["Control_L", "Control_R", "Shift_L", "Shift_R"];
		var clipboard_modifier = "control";
		if (Utilities.isMacOS()) {
			//Apple does things differently, as usual:
			clipboard_modifier_keys = ["Meta_L", "Meta_R", "Shift_L", "Shift_R"];
			clipboard_modifier = "meta";
		}
		//let the OS see Control (or Meta on macos) and Shift:
		if (clipboard_modifier_keys.indexOf(keyname)>=0) {
			this.debug("keyboard", "passing clipboard modifier key event to browser:", keyname);
			return true;
		}
		//let the OS see Shift + Insert:
		if (shift && keyname=="Insert") {
			this.debug("keyboard", "passing clipboard combination Shift+Insert to browser");
			return true;
		}
		var clipboard_mod_set = raw_modifiers.indexOf(clipboard_modifier)>=0;
		if (clipboard_mod_set) {
			var l = keyname.toLowerCase();
			if (l=="c" || l=="x" || l=="v") {
				this.debug("keyboard", "passing clipboard combination to browser:", clipboard_modifier, "+", keyname);
				return true;
			}
		}
	}
	return false;
}


XpraClient.prototype._keyb_onkeydown = function(event, ctx) {
	return ctx._keyb_process(true, event);
};
XpraClient.prototype._keyb_onkeyup = function(event, ctx) {
	return ctx._keyb_process(false, event);
};

XpraClient.prototype._keyb_onkeypress = function(event, ctx) {
	/**
	 * This function is only used for figuring out the caps_lock state!
	 * onkeyup and onkeydown give us the raw keycode,
	 * whereas here we get the keycode in lowercase/uppercase depending
	 * on the caps_lock and shift state, which allows us to figure
	 * out caps_lock state since we have shift state.
	 */
	var keycode = 0;
	if (event.which)
		keycode = event.which;
	else
		keycode = event.keyCode;
	var modifiers = ctx._keyb_get_modifiers(event);

	/* PITA: this only works for keypress event... */
	var shift = modifiers.indexOf("shift")>=0;
	if (keycode>=97 && keycode<=122 && shift) {
		ctx.caps_lock = true;
	}
	else if (keycode>=65 && keycode<=90 && !shift) {
		ctx.caps_lock = true;
	}
	else {
		ctx.caps_lock = false;
	}
	//show("caps_lock="+caps_lock);
	return false;
};

XpraClient.prototype._get_keyboard_layout = function() {
	this.debug("keyboard", "_get_keyboard_layout() keyboard_layout=", this.keyboard_layout);
	if (this.keyboard_layout)
		return this.keyboard_layout;
	return Utilities.getKeyboardLayout();
}

XpraClient.prototype._get_keycodes = function() {
	//keycodes.append((nn(keyval), nn(name), nn(keycode), nn(group), nn(level)))
	var keycodes = [];
	var kc;
	for(var keycode in CHARCODE_TO_NAME) {
		kc = parseInt(keycode);
		keycodes.push([kc, CHARCODE_TO_NAME[keycode], kc, 0, 0]);
	}
	//show("keycodes="+keycodes.toSource());
	return keycodes;
}

XpraClient.prototype._get_desktop_size = function() {
	return [this.desktop_width, this.desktop_height];
}

XpraClient.prototype._get_DPI = function() {
	"use strict";

	var dpi_div = document.getElementById("dpi");
	if (dpi_div != undefined) {
		//show("dpiX="+dpi_div.offsetWidth+", dpiY="+dpi_div.offsetHeight);
		if (dpi_div.offsetWidth>0 && dpi_div.offsetHeight>0)
			return Math.round((dpi_div.offsetWidth + dpi_div.offsetHeight) / 2.0);
	}
	//alternative:
	if ('deviceXDPI' in screen)
		return (screen.systemXDPI + screen.systemYDPI) / 2;
	//default:
	return 96;
}

XpraClient.prototype._get_screen_sizes = function() {
	var dpi = this._get_DPI();
	var screen_size = [this.container.clientWidth, this.container.clientHeight];
	var wmm = Math.round(screen_size[0]*25.4/dpi);
	var hmm = Math.round(screen_size[1]*25.4/dpi);
	var monitor = ["Canvas", 0, 0, screen_size[0], screen_size[1], wmm, hmm];
	var screen = ["HTML", screen_size[0], screen_size[1],
				wmm, hmm,
				[monitor],
				0, 0, screen_size[0], screen_size[1]
			];
	//just a single screen:
	return [screen];
}

XpraClient.prototype._get_encodings = function() {
	if(this.enabled_encodings.length == 0) {
		// return all supported encodings
		console.log("return all encodings: ", this.supported_encodings);
		return this.supported_encodings;
	} else {
		console.log("return just enabled encodings: ", this.enabled_encodings);
		return this.enabled_encodings;
	}
}

XpraClient.prototype._update_capabilities = function(appendobj) {
	for (var attr in appendobj) {
		this.capabilities[attr] = appendobj[attr];
	}
}

/**
 * Ping
 */
XpraClient.prototype._check_server_echo = function(ping_sent_time) {
	var last = this.server_ok;
	this.server_ok = this.last_ping_echoed_time >= ping_sent_time;
	//console.log("check_server_echo", this.server_ok, "last", last, "last_time", this.last_ping_echoed_time, "this_this", ping_sent_time);
	if(last != this.server_ok) {
		if(!this.server_ok) {
			console.log("server connection is not responding, drawing spinners...");
		} else {
			console.log("server connection is OK");
		}
		for (var i in this.id_to_window) {
			var iwin = this.id_to_window[i];
			iwin.set_spinner(this.server_ok);
		}
	}
}

XpraClient.prototype._check_echo_timeout = function(ping_time) {
	if (this.reconnect_in_progress) {
		return;
	}
	if(this.last_ping_echoed_time < ping_time) {
		if (this.reconnect && this.reconnect_attempt<this.reconnect_count) {
			this.warn("ping timeout - reconnecting");
			this.reconnect_attempt++;
			this.do_reconnect();
		}
		else {
			// no point in telling the server here...
			this.callback_close("server ping timeout, waited "+ this.PING_TIMEOUT +"ms without a response");
		}
	}
}

XpraClient.prototype._send_ping = function() {
	if (this.reconnect_in_progress) {
		return;
	}
	var me = this;
	var now_ms = Math.ceil(Utilities.monotonicTime());
	this.send(["ping", now_ms]);
	// add timeout to wait for ping timout
	this.ping_timeout_timer = setTimeout(function () {
		me._check_echo_timeout(now_ms);
	}, this.PING_TIMEOUT);
	// add timeout to detect temporary ping miss for spinners
	var wait = 2000;
	this.ping_grace_timer = setTimeout(function () {
		me._check_server_echo(now_ms);
	}, wait);
}

/**
 * Hello
 */
XpraClient.prototype._send_hello = function(challenge_response, client_salt) {
	// make the base hello
	this._make_hello_base();
	// handle a challenge if we need to
	if((this.password) && (!challenge_response)) {
		// tell the server we expect a challenge (this is a partial hello)
		this.capabilities["challenge"] = true;
		console.log("sending partial hello");
	} else {
		console.log("sending hello");
		// finish the hello
		this._make_hello();
	}
	if(challenge_response) {
		this._update_capabilities({
			"challenge_response": challenge_response
		});
		if(client_salt) {
			this._update_capabilities({
				"challenge_client_salt" : client_salt
			});
		}
	}
	console.log("hello capabilities: "+this.capabilities);
	// verify:
	for (var key in this.capabilities) {
	    var value = this.capabilities[key];
	    if(key==null) {
	    	throw "invalid null key in hello packet data";
	    }
	    else if(value==null) {
	    	throw "invalid null value for key "+key+" in hello packet data";
	    }
	}
	// send the packet
	this.send(["hello", this.capabilities]);
}

XpraClient.prototype._make_hello_base = function() {
	this.capabilities = {};
	var digests = ["hmac", "hmac+md5", "xor"]
	if (typeof forge!=='undefined') {
		try {
			this.debug("network", "forge.md.algorithms=", forge.md.algorithms);
			for (var hash in forge.md.algorithms) {
				digests.push("hmac+"+hash);
			}
			this.debug("network", "digests:", digests);
		}
		catch (e) {
			console.error("Error probing forge crypto digests:", e);
		}
	}
	else {
		console.log("cryptography library 'forge' not found");
	}
	this._update_capabilities({
		// version and platform
		"version"					: Utilities.VERSION,
		"platform"					: Utilities.getPlatformName(),
		"platform.name"				: Utilities.getPlatformName(),
		"platform.processor"		: Utilities.getPlatformProcessor(),
		"platform.platform"			: navigator.appVersion,
		"session-type"				: Utilities.getSimpleUserAgentString(),
		"session-type.full"			: navigator.userAgent,
		"namespace"			 		: true,
		"share"						: this.sharing,
		"steal"						: this.steal,
		"client_type"				: "HTML5",
		"encoding.generic" 			: true,
		"username" 					: this.username,
		"uuid"						: this.uuid,
		"argv" 						: [window.location.href],
		"digest" 					: digests,
		"salt-digest" 				: digests,
		//compression bits:
		"zlib"						: true,
		"lzo"						: false,
		"compression_level"	 		: 1,
		// packet encoders
		"rencode" 					: false,
		"bencode"					: true,
		"yaml"						: false,
		"open-url"					: this.open_url,
	});
	if (this.bandwidth_limit>0) {
		this._update_capabilities({
			"bandwidth-limit"	: this.bandwidth_limit,
		})
	}
	var ci = Utilities.getConnectionInfo();
	if (ci) {
		this._update_capabilities({
			"connection-data"	: ci,
		})
	}
	var LZ4 = require('lz4');
	if(LZ4) {
		this._update_capabilities({
			"lz4"						: true,
			"lz4.js.version"			: LZ4.version,
			"encoding.rgb_lz4"			: true,
		});
	}

	if(this.encryption) {
		this.cipher_in_caps = {
			"cipher"					: this.encryption,
			"cipher.iv"					: Utilities.getHexUUID().slice(0, 16),
			"cipher.key_salt"			: Utilities.getHexUUID()+Utilities.getHexUUID(),
			"cipher.key_stretch_iterations"	: 1000,
			"cipher.padding.options"	: ["PKCS#7"],
		};
		this._update_capabilities(this.cipher_in_caps);
		// copy over the encryption caps with the key for recieved data
		this.protocol.set_cipher_in(this.cipher_in_caps, this.encryption_key);
	}
	if(this.start_new_session) {
		this._update_capabilities({"start-new-session" : this.start_new_session});
	}
}

XpraClient.prototype._make_hello = function() {
	this.desktop_width = this.container.clientWidth;
	this.desktop_height = this.container.clientHeight;
	this._update_capabilities({
		"auto_refresh_delay"		: 500,
		"randr_notify"				: true,
		"sound.server_driven"		: true,
		"server-window-resize"		: true,
		"notify-startup-complete"	: true,
		"generic-rgb-encodings"		: true,
		"window.raise"				: true,
        "window.initiate-moveresize": true,
        "metadata.supported"		: [
        								"fullscreen", "maximized", "above", "below",
        								//"set-initial-position", "group-leader",
        								"title", "size-hints", "class-instance", "transient-for", "window-type", "has-alpha",
        								"decorations", "override-redirect", "tray", "modal", "opacity",
        								//"shadow", "desktop",
        								],
		"encodings"					: this._get_encodings(),
		"raw_window_icons"			: true,
		"encoding.icons.max_size"	: [30, 30],
		"encodings.core"			: this._get_encodings(),
		"encodings.rgb_formats"	 	: this.RGB_FORMATS,
		"encodings.window-icon"		: ["png"],
		"encodings.cursor"			: ["png"],
		"encoding.generic"			: true,
		"encoding.flush"			: true,
		"encoding.transparency"		: true,
		"encoding.client_options"	: true,
		"encoding.csc_atoms"		: true,
		"encoding.scrolling"		: true,
		//"encoding.scrolling.min-percent" : 30,
		//"encoding.min-speed"		: 80,
		//"encoding.min-quality"	: 50,
		"encoding.color-gamut"		: Utilities.getColorGamut(),
		//"encoding.non-scroll"		: ["rgb32", "png", "jpeg"],
		//video stuff:
		"encoding.video_scaling"	: true,
		"encoding.video_max_size"	: [1024, 768],
		"encoding.eos"				: true,
		"encoding.full_csc_modes"	: {
			"mpeg1"		: ["YUV420P"],
			"h264" 		: ["YUV420P"],
			"mpeg4+mp4"	: ["YUV420P"],
			"h264+mp4"	: ["YUV420P"],
			"vp8+webm"	: ["YUV420P"],
			"webp"		: ["BGRX", "BGRA"],
		},
		"encoding.h264.YUV420P.profile"		: "baseline",
		"encoding.h264.YUV420P.level"		: "2.1",
		"encoding.h264.cabac"				: false,
		"encoding.h264.deblocking-filter"	: false,
		"encoding.h264.fast-decode"			: true,
		"encoding.h264+mp4.YUV420P.profile"	: "main",
		"encoding.h264+mp4.YUV420P.level"	: "3.0",
		//prefer native video in mp4/webm container to broadway plain h264:
		"encoding.h264.score-delta"			: -20,
		"encoding.h264+mp4.score-delta"		: 50,
		"encoding.mpeg4+mp4.score-delta"	: 50,
		"encoding.vp8+webm.score-delta"		: 50,

		"sound.receive"				: true,
		"sound.send"				: false,
		"sound.decoders"			: Object.keys(this.audio_codecs),
		"sound.bundle-metadata"		: true,
		// encoding stuff
		"encoding.rgb24zlib"		: true,
		"encoding.rgb_zlib"			: true,
		"windows"					: true,
		//partial support:
		"keyboard"					: true,
		"xkbmap_layout"				: this._get_keyboard_layout(),
		"xkbmap_keycodes"			: this._get_keycodes(),
		"xkbmap_print"				: "",
		"xkbmap_query"				: "",
		"desktop_size"				: [this.desktop_width, this.desktop_height],
		"desktop_mode_size"			: [this.desktop_width, this.desktop_height],
		"screen_sizes"				: this._get_screen_sizes(),
		"dpi"						: this._get_DPI(),
		//not handled yet, but we will:
		"clipboard_enabled"			: this.clipboard_enabled,
		"clipboard.want_targets"	: true,
		"clipboard.greedy"			: true,
		"clipboard.selections"		: ["CLIPBOARD", "PRIMARY"],
		"notifications"				: true,
		"notifications.close"		: true,
		"notifications.actions"		: true,
		"cursors"					: true,
		"bell"						: true,
		"system_tray"				: true,
		//we cannot handle this (GTK only):
		"named_cursors"				: false,
		// printing
		"file-transfer" 			: this.file_transfer,
		"printing" 					: this.printing,
		"file-size-limit"			: 10,
	});
}


XpraClient.prototype.on_first_ui_event = function() {
	//this hook can be overriden
}

XpraClient.prototype._new_ui_event = function() {
	if (this.ui_events==0) {
		this.on_first_ui_event();
	}
	this.ui_events++;
}

/**
 * Mouse handlers
 */
XpraClient.prototype.getMouse = function(e, window) {
	// get mouse position take into account scroll
	var mx = e.clientX + jQuery(document).scrollLeft();
	var my = e.clientY + jQuery(document).scrollTop();

	// check last mouse position incase the event
	// hasn't provided it - bug #854
	if(isNaN(mx) || isNaN(my)) {
		if(!isNaN(this.last_mouse_x) && !isNaN(this.last_mouse_y)) {
			mx = this.last_mouse_x;
			my = this.last_mouse_y;
		} else {
			// should we avoid sending NaN to the server?
			mx = 0;
			my = 0;
		}
	} else {
		this.last_mouse_x = mx;
		this.last_mouse_y = my;
	}

	var mbutton = 0;
	if ("which" in e)  // Gecko (Firefox), WebKit (Safari/Chrome) & Opera
		mbutton = Math.max(0, e.which);
	else if ("button" in e)  // IE, Opera (zero based)
		mbutton = Math.max(0, e.button)+1;
	//show("getmouse: button="+mbutton+", which="+e.which+", button="+e.button);

	if (window && this.server_is_desktop) {
		//substract window offset since the desktop's top-left corner should be at 0,0:
		var pos = jQuery(window.div).position()
		mx -= pos.left;
		my -= pos.top;
	}

	// We return a simple javascript object (a hash) with x and y defined
	return {x: mx, y: my, button: mbutton};
};

XpraClient.prototype.on_mousemove = function(e) {
	this.do_window_mouse_move(e, null);
};

XpraClient.prototype.on_mousedown = function(e) {
	this.do_window_mouse_click(e, null, true);
};

XpraClient.prototype.on_mouseup = function(e) {
	this.do_window_mouse_click(e, null, false);
};

XpraClient.prototype.on_mousescroll = function(e) {
	this.do_window_mouse_scroll(e, null);
}


XpraClient.prototype._window_mouse_move = function(ctx, e, window) {
	ctx.do_window_mouse_move(e, window);
}
XpraClient.prototype.do_window_mouse_move = function(e, window) {
	this._check_browser_language();
	var mouse = this.getMouse(e, window),
		x = Math.round(mouse.x),
		y = Math.round(mouse.y);
	var modifiers = [];
	var buttons = [];
	var wid = 0;
	if (window) {
		wid = window.wid;
	}
	this.send(["pointer-position", wid, [x, y], modifiers, buttons]);
}

XpraClient.prototype._window_mouse_down = function(ctx, e, window) {
	ctx.mousedown_event = e;
	ctx.do_window_mouse_click(e, window, true);
}

XpraClient.prototype._window_mouse_up = function(ctx, e, window) {
	//this.mousedown_event = null;
	ctx.do_window_mouse_click(e, window, false);
}

XpraClient.prototype.do_window_mouse_click = function(e, window, pressed) {
	var mouse = this.getMouse(e, window),
		x = Math.round(mouse.x),
		y = Math.round(mouse.y);
	var modifiers = [];
	var buttons = [];
	var wid = 0;
	if (window) {
		wid = window.wid;
	}
	// dont call set focus unless the focus has actually changed
	if (wid>0 && this.focus != wid) {
		this._window_set_focus(window);
	}
	var button = mouse.button;
	this.debug("mouse", "click:", button, pressed, x, y);
	if (button==4) {
		button = 8;
	}
	else if (button==5) {
		button = 9;
	}
	var me = this;
	setTimeout(function() {
		me.send(["button-action", wid, button, pressed, [x, y], modifiers, buttons]);
	}, 0);
}

XpraClient.prototype._window_mouse_scroll = function(ctx, e, window) {
	ctx.do_window_mouse_scroll(e, window);
}

XpraClient.prototype.do_window_mouse_scroll = function(e, window) {
	var mouse = this.getMouse(e, window),
		x = Math.round(mouse.x),
		y = Math.round(mouse.y);
	var modifiers = [];
	var buttons = [];
	var wid = 0;
	if (window) {
		wid = window.wid;
	}
	var wheel = Utilities.normalizeWheel(e);
	this.debug("mouse", "normalized wheel event:", wheel);
	//clamp to prevent event floods:
	var px = Math.min(1200, wheel.pixelX);
	var py = Math.min(1200, wheel.pixelY);
	var apx = Math.abs(px);
	var apy = Math.abs(py);
	if (this.server_precise_wheel) {
        if (apx>0) {
    		var btn_x = (px>=0) ? 6 : 7;
            var xdist = Math.round(px*1000/120);
            this.send(["wheel-motion", wid, btn_x, -xdist,
            	(x, y), modifiers, buttons]);
        }
        if (apy>0) {
    		var btn_y = (py>=0) ? 5 : 4;
            var ydist = Math.round(py*1000/120);
            this.send(["wheel-motion", wid, btn_y, -ydist,
                (x, y), modifiers, buttons]);
        }
        return;
	}
	//generate a single event if we can, or add to accumulators:
	if (apx>=40 && apx<=160) {
		this.wheel_delta_x = (px>0) ? 120 : -120;
	}
	else {
		this.wheel_delta_x += px;
	}
	if (apy>=40 && apy<=160) {
		this.wheel_delta_y = (py>0) ? 120 : -120;
	}
	else {
		this.wheel_delta_y += py;
	}
	//send synthetic click+release as many times as needed:
	var wx = Math.abs(this.wheel_delta_x);
	var wy = Math.abs(this.wheel_delta_y);
	var btn_x = (this.wheel_delta_x>=0) ? 6 : 7;
	var btn_y = (this.wheel_delta_y>=0) ? 5 : 4;
	while (wx>=120) {
		wx -= 120;
		this.send(["button-action", wid, btn_x, true, [x, y], modifiers, buttons]);
		this.send(["button-action", wid, btn_x, false, [x, y], modifiers, buttons]);
	}
	while (wy>=120) {
		wy -= 120;
		this.send(["button-action", wid, btn_y, true, [x, y], modifiers, buttons]);
		this.send(["button-action", wid, btn_y, false, [x, y], modifiers, buttons]);
	}
	//store left overs:
	this.wheel_delta_x = (this.wheel_delta_x>=0) ? wx : -wx;
	this.wheel_delta_y = (this.wheel_delta_y>=0) ? wy : -wy;
}


/**
 * Focus
 */
XpraClient.prototype._window_set_focus = function(win) {
	// don't send focus packet for override_redirect windows!
	if (win.override_redirect || win.tray) {
		return;
	}
	var client = win.client;
	var wid = win.wid;
	if (client.focus == wid) {
		return;
	}
	var top_stacking_layer = Object.keys(client.id_to_window).length;
	var old_stacking_layer = win.stacking_layer;
	client.focus = wid;
	client.topwindow = wid;
	client.send(["focus", wid, []]);
	//set the focused flag on all windows,
	//adjust stacking order:
	var iwin = null;
	for (var i in client.id_to_window) {
		iwin = client.id_to_window[i];
		iwin.focused = (i==wid);
		if (iwin.focused) {
			iwin.stacking_layer = top_stacking_layer;
		}
		else {
			//move it down to fill the gap:
			if (iwin.stacking_layer>old_stacking_layer) {
				iwin.stacking_layer--;
			}
		}
		iwin.updateFocus();
		iwin.update_zindex();
	}
	//client._set_favicon(wid);
}

/*
 * packet processing functions start here
 */

XpraClient.prototype.on_open = function() {
	//this hook can be overriden
}

XpraClient.prototype._process_open = function(packet, ctx) {
	// call the send_hello function
	ctx.on_connection_progress("WebSocket connection established", "", 80);
	// wait timeout seconds for a hello, then bomb
	ctx.hello_timer = setTimeout(function () {
		ctx.disconnect_reason = "Did not receive hello before timeout reached, not an Xpra server?";
		ctx.close();
	}, ctx.HELLO_TIMEOUT);
	ctx._send_hello();
	ctx.on_open();
}

XpraClient.prototype._process_error = function(packet, ctx) {
	console.error("websocket error: ", packet[1], "reason: ", ctx.disconnect_reason);
	if (ctx.reconnect_in_progress) {
		return;
	}
	if (!ctx.disconnect_reason && packet[1]) {
		ctx.disconnect_reason = packet[1];
	}
	ctx.close_audio();
	if (!ctx.reconnect || ctx.reconnect_attempt>=ctx.reconnect_count) {
		// call the client's close callback
		ctx.callback_close(ctx.disconnect_reason);
	}
}


XpraClient.prototype.do_reconnect = function() {
	//try again:
	this.reconnect_in_progress = true;
	var me = this;
	var protocol = this.protocol;
	setTimeout(function(){
		try {
			me.close_windows();
			me.close_audio();
			me.clear_timers();
			me.init_state();
			if (protocol) {
				this.protocol = null;
				protocol.terminate();
			}
			me.connect();
		}
		finally {
			me.reconnect_in_progress = false;
		}
	}, this.reconnect_delay);
}

XpraClient.prototype._process_close = function(packet, ctx) {
	console.log("websocket closed: ", packet[1], "reason: ", ctx.disconnect_reason, ", reconnect: ", ctx.reconnect, ", reconnect attempt: ", ctx.reconnect_attempt);
	if (ctx.reconnect_in_progress) {
		return;
	}
	if (!ctx.disconnect_reason && packet[1]) {
		ctx.disconnect_reason = packet[1];
	}
	if (ctx.reconnect && ctx.reconnect_attempt<ctx.reconnect_count) {
		ctx.reconnect_attempt++;
		ctx.do_reconnect();
	}
	else {
		ctx.close();
	}
}

XpraClient.prototype.close = function() {
	this.close_windows();
	this.close_audio();
	this.clear_timers();
	this.close_protocol();
	// call the client's close callback
	this.callback_close(this.disconnect_reason);
}

XpraClient.prototype._process_disconnect = function(packet, ctx) {
	// save the disconnect reason
	var reason = packet[1];
	ctx.debug("main", "disconnect reason:", reason);
	if (ctx.reconnect_in_progress) {
		return;
	}
	ctx.disconnect_reason = reason;
	ctx.close();
	// call the client's close callback
	ctx.callback_close(reason);
}

XpraClient.prototype._process_startup_complete = function(packet, ctx) {
	ctx.log("startup complete");
}

XpraClient.prototype._connection_change = function(e) {
	var ci = Utilities.getConnectionInfo();
	console.log("connection status - change event=", e, ", connection info=", ci, "tell server:", this.server_connection_data);
	if (ci && this.server_connection_data) {
		this.send(["connection-data", ci]);
	}
}


XpraClient.prototype._process_hello = function(packet, ctx) {
	//show("process_hello("+packet+")");
	// clear hello timer
	if(ctx.hello_timer) {
		clearTimeout(ctx.hello_timer);
		ctx.hello_timer = null;
	}
	var hello = packet[1];
	ctx.server_remote_logging = hello["remote-logging.multi-line"];
	if(ctx.server_remote_logging && ctx.remote_logging) {
		//hook remote logging:
		Utilities.log = function() { ctx.log.apply(ctx, arguments); };
		Utilities.warn = function() { ctx.warn.apply(ctx, arguments); };
		Utilities.error = function() { ctx.error.apply(ctx, arguments); };
	}

	// check for server encryption caps update
	if(ctx.encryption) {
		ctx.cipher_out_caps = {
			"cipher"					: hello['cipher'],
			"cipher.iv"					: hello['cipher.iv'],
			"cipher.key_salt"			: hello['cipher.key_salt'],
			"cipher.key_stretch_iterations"	: hello['cipher.key_stretch_iterations'],
		};
		ctx.protocol.set_cipher_out(ctx.cipher_out_caps, ctx.encryption_key);
	}
	// find the modifier to use for Num_Lock
	var modifier_keycodes = hello['modifier_keycodes']
	if (modifier_keycodes) {
		for (var modifier in modifier_keycodes) {
			if (modifier_keycodes.hasOwnProperty(modifier)) {
				var mappings = modifier_keycodes[modifier];
				for (var keycode in mappings) {
					var keys = mappings[keycode];
					for (var index in keys) {
						var key=keys[index];
						if (key=="Num_Lock") {
							ctx.num_lock_mod = modifier;
						}
					}
				}
			}
		}
	}

	var version = hello["version"];
	try {
		var vparts = version.split(".");
		var vno = [];
		for (var i=0; i<vparts.length;i++) {
			vno[i] = parseInt(vparts[i]);
		}
		if (vno[0]<=0 && vno[1]<10) {
			ctx.callback_close("unsupported version: " + version);
			ctx.close();
			return;
		}
	}
	catch (e) {
		ctx.callback_close("error parsing version number '" + version + "'");
		ctx.close();
		return;
	}
	ctx.log("got hello: server version "+version+" accepted our connection");
	//figure out "alt" and "meta" keys:
	if ("modifier_keycodes" in hello) {
		var modifier_keycodes = hello["modifier_keycodes"];
		for (var mod in modifier_keycodes) {
			//show("modifier_keycode["+mod+"]="+modifier_keycodes[mod].toSource());
			var keys = modifier_keycodes[mod];
			for (var i=0; i<keys.length; i++) {
				var key = keys[i];
				//the first value is usually the integer keycode,
				//the second one is the actual key name,
				//doesn't hurt to test both:
				for (var j=0; j<key.length; j++) {
					if ("Alt_L"==key[j])
						ctx.alt_modifier = mod;
					if ("Meta_L"==key[j])
						ctx.meta_modifier = mod;
				}
			}
		}
	}
	//show("alt="+alt_modifier+", meta="+meta_modifier);
	// stuff that must be done after hello
	if(ctx.audio_enabled) {
		if(!(hello["sound.send"])) {
			ctx.error("server does not support speaker forwarding");
			ctx.audio_enabled = false;
		}
		else {
			ctx.server_audio_codecs = hello["sound.encoders"];
			if(!ctx.server_audio_codecs) {
				ctx.error("audio codecs missing on the server");
				ctx.audio_enabled = false;
			}
			else {
				ctx.log("audio codecs supported by the server:", ctx.server_audio_codecs);
				if(ctx.server_audio_codecs.indexOf(ctx.audio_codec)<0) {
					ctx.warn("audio codec "+ctx.audio_codec+" is not supported by the server");
					ctx.audio_codec = null;
					//find the best one we can use:
					for(var i = 0; i < MediaSourceConstants.PREFERRED_CODEC_ORDER.length; i++) {
						var codec = MediaSourceConstants.PREFERRED_CODEC_ORDER[i];
						if ((codec in ctx.audio_codecs) && (ctx.server_audio_codecs.indexOf(codec)>=0)){
							if (ctx.mediasource_codecs[codec]) {
								ctx.audio_framework = "mediasource";
							}
							else {
								ctx.audio_framework = "aurora";
							}
							ctx.audio_codec = codec;
							ctx.log("using", ctx.audio_framework, "audio codec", codec);
							break;
						}
					}
					if(!ctx.audio_codec) {
						ctx.warn("audio codec: no matches found");
						ctx.audio_enabled = false;
					}
				}
			}
			if (ctx.audio_enabled) {
				ctx._sound_start_receiving();
			}
		}
	}
    ctx.server_is_desktop = Boolean(hello["desktop"]) || Boolean(hello["shadow"]);
    if (ctx.server_is_desktop) {
    	jQuery("body").addClass("desktop");
    }
    ctx.server_resize_exact = hello["resize_exact"] || false;
    ctx.server_screen_sizes = hello["screen-sizes"] || [];
    console.log("server screen sizes:", ctx.server_screen_sizes)

    ctx.server_precise_wheel = hello["wheel.precise"] || false;

	ctx.remote_open_files = Boolean(hello["open-files"]);
	ctx.remote_file_transfer = Boolean(hello["file-transfer"]);
	ctx.remote_printing = Boolean(hello["printing"]);
	if (ctx.remote_printing && ctx.printing) {
		// send our printer definition
		var printers = {
			"HTML5 client": {
				"printer-info": "Print to PDF in client browser",
				"printer-make-and-model": "HTML5 client version",
				"mimetypes": ["application/pdf"]
			}
		};
		ctx.send(["printers", printers]);
	}
	ctx.server_connection_data = hello["connection-data"];
	if (navigator.connection) {
		navigator.connection.onchange = ctx._connection_change;
		ctx._connection_change();
	}

	// start sending our own pings
	ctx._send_ping();
	ctx.ping_timer = setInterval(function () {
		ctx._send_ping();
		return true;
	}, ctx.PING_FREQUENCY);
	ctx.reconnect_attempt = 0;
	ctx.on_connection_progress("Session started", "", 100);
	ctx.on_connect();
}

XpraClient.prototype.on_connect = function() {
	//this hook can be overriden
}

XpraClient.prototype._process_challenge = function(packet, ctx) {
	console.log("process challenge");
	if ((!ctx.password) || (ctx.password == "")) {
		ctx.callback_close("No password specified for authentication challenge");
		return;
	}
	if(ctx.encryption) {
		if(packet.length >=3) {
			ctx.cipher_out_caps = packet[2];
			ctx.protocol.set_cipher_out(ctx.cipher_out_caps, ctx.encryption_key);
		} else {
			ctx.callback_close("challenge does not contain encryption details to use for the response");
			return;
		}
	}
	var digest = packet[3];
	var server_salt = packet[1];
	var client_salt = null;
    var salt_digest = packet[4] || "xor";
    var l = server_salt.length;
    if (salt_digest=="xor") {
    	//don't use xor over unencrypted connections unless explicitly allowed:
    	if (digest == "xor") {
    		if((!ctx.ssl) && (!ctx.encryption) && (!ctx.insecure) && (ctx.host!="localhost") && (ctx.host!="127.0.0.1")) {
    			ctx.callback_close("server requested digest xor, cowardly refusing to use it without encryption with "+ctx.host);
    			return;
    		}
    	}
    	if (l<16 || l>256) {
    		ctx.callback_close("invalid server salt length for xor digest:"+l);
    		return;
    	}
    }
    else {
        //other digest, 32 random bytes is enough:
    	l = 32;
    }
	client_salt = Utilities.getSalt(l);
	console.log("challenge using salt digest", salt_digest);
	var salt = ctx._gendigest(salt_digest, client_salt, server_salt);
	if (!salt) {
		this.callback_close("server requested an unsupported salt digest " + salt_digest);
		return;
	}
	console.log("challenge using digest", digest);
	var challenge_response = ctx._gendigest(digest, ctx.password, salt);
	if (challenge_response) {
		ctx._send_hello(challenge_response, client_salt);
	}
	else {
		this.callback_close("server requested an unsupported digest " + digest);
	}
}

XpraClient.prototype._gendigest = function(digest, password, salt) {
	if (digest.startsWith("hmac")) {
		var hash="md5";
		if (digest.indexOf("+")>0) {
			hash = digest.split("+")[1];
		}
		console.log("hmac using hash", hash);
		var hmac = forge.hmac.create();
		hmac.start(hash, password);
		hmac.update(salt);
		return hmac.digest().toHex();
	} else if (digest == "xor") {
		var trimmed_salt = salt.slice(0, password.length);
		return Utilities.xorString(trimmed_salt, password);
	} else {
		return null;
	}
}

XpraClient.prototype._process_ping = function(packet, ctx) {
	var echotime = packet[1];
	ctx.last_ping_server_time = echotime;
	if (packet.length>2) {
		//prefer system time (packet[1] is monotonic)
		ctx.last_ping_server_time = packet[2];
	}
	ctx.last_ping_local_time = new Date().getTime();
	var l1=0, l2=0, l3=0;
	ctx.send(["ping_echo", echotime, l1, l2, l3, 0]);
}

XpraClient.prototype._process_ping_echo = function(packet, ctx) {
	ctx.last_ping_echoed_time = packet[1];
	// make sure server goes OK immediately instead of waiting for next timeout
	ctx._check_server_echo(0);
}

/**
 * System Tray forwarding
 */
XpraClient.prototype._process_new_tray = function(packet, ctx) {
    var wid = packet[1],
    	w = packet[2],
    	h = packet[3],
        metadata = packet[4];
	var mydiv = document.createElement("div");
	mydiv.id = String(wid);
	var mycanvas = document.createElement("canvas");
	mydiv.appendChild(mycanvas);
	var top_bar = document.getElementById("top_bar");
	top_bar.appendChild(mydiv);
	var x = 100;
	var y = 0;
	w = 48;
	h = 48;
	mycanvas.width = w;
	mycanvas.height = h;
	var win = new XpraWindow(ctx, mycanvas, wid, x, y, w, h,
		metadata,
		false,
		true,
		{},
		ctx._tray_geometry_changed,
		ctx._window_mouse_move,
		ctx._window_mouse_down,
		ctx._window_mouse_up,
		ctx._window_mouse_scroll,
		ctx._tray_set_focus,
		ctx._tray_closed
		);
	ctx.id_to_window[wid] = win;
	ctx.send_tray_configure(wid);
}
XpraClient.prototype.send_tray_configure = function(wid) {
	var div = jQuery("#" + String(wid));
	var x = Math.round(div.offset().left);
	var y = Math.round(div.offset().top);
	var w = 48, h = 48;
	console.log("tray", wid, "position:", x, y);
	this.send(["configure-window", Number(wid), x, y, w, h, {}]);
}
XpraClient.prototype._tray_geometry_changed = function(win) {
	ctx.debug("main", "tray geometry changed (ignored)");
}
XpraClient.prototype._tray_set_focus = function(win) {
	ctx.debug("main", "tray set focus (ignored)");
}
XpraClient.prototype._tray_closed = function(win) {
	ctx.debug("main", "tray closed (ignored)");
}

XpraClient.prototype.reconfigure_all_trays = function() {
	for (var twid in this.id_to_window) {
		var twin = this.id_to_window[twid];
		if (twin && twin.tray) {
			this.send_tray_configure(twid);
		}
	}
}

/**
 * Windows
 */
XpraClient.prototype._new_window = function(wid, x, y, w, h, metadata, override_redirect, client_properties) {
	// each window needs their own DIV that contains a canvas
	var mydiv = document.createElement("div");
	mydiv.id = String(wid);
	var mycanvas = document.createElement("canvas");
	mydiv.appendChild(mycanvas);
	var screen = document.getElementById("screen");
	screen.appendChild(mydiv);
	// set initial sizes
	mycanvas.width = w;
	mycanvas.height = h;
	// create the XpraWindow object to own the new div
	var win = new XpraWindow(this, mycanvas, wid, x, y, w, h,
		metadata,
		override_redirect,
		false,
		client_properties,
		this._window_geometry_changed,
		this._window_mouse_move,
		this._window_mouse_down,
		this._window_mouse_up,
		this._window_mouse_scroll,
		this._window_set_focus,
		this._window_closed
		);
	this.id_to_window[wid] = win;
	if (!override_redirect) {
		var geom = win.get_internal_geometry();
		this.send(["map-window", wid, geom.x, geom.y, geom.w, geom.h, this._get_client_properties(win)]);
		this._window_set_focus(win);
	}
}

XpraClient.prototype._new_window_common = function(packet, override_redirect) {
	var wid, x, y, w, h, metadata;
	wid = packet[1];
	x = packet[2];
	y = packet[3];
	w = packet[4];
	h = packet[5];
	metadata = packet[6];
	if (wid in this.id_to_window)
		throw "we already have a window " + wid;
	if (w<=0 || h<=0) {
		this.error("window dimensions are wrong: "+w+"x"+h);
		w, h = 1, 1;
	}
	var client_properties = {}
	if (packet.length>=8)
		client_properties = packet[7];
	if (x==0 && y==0 && !metadata["set-initial-position"]) {
		//find a good position for it
		var l = Object.keys(this.id_to_window).length;
		if (l==0) {
			//first window: center it
			x = Math.round((this.desktop_width-w)/2);
			if (w<this.desktop_height) {
				y = Math.round((this.desktop_height-h)/2);
			}
		}
		else {
			x = Math.min(l*10, Math.max(0, this.desktop_width-100));
			y = 96;
		}
	}
	this._new_window(wid, x, y, w, h, metadata, override_redirect, client_properties)
	this._new_ui_event();
}

XpraClient.prototype._window_closed = function(win) {
	win.client.send(["close-window", win.wid]);
}

XpraClient.prototype._get_client_properties = function(win) {
	var cp = win.client_properties;
	cp["encodings.rgb_formats"] = this.RGB_FORMATS;
	return cp;
}

XpraClient.prototype._window_geometry_changed = function(win) {
	// window callbacks are called from the XpraWindow function context
	// so use win.client instead of `this` to refer to the client
	var geom = win.get_internal_geometry();
	var wid = win.wid;
	win.client.send(["configure-window", wid, geom.x, geom.y, geom.w, geom.h, win.client._get_client_properties(win)]);
}

XpraClient.prototype._process_new_window = function(packet, ctx) {
	ctx._new_window_common(packet, false);
}

XpraClient.prototype._process_new_override_redirect = function(packet, ctx) {
	ctx._new_window_common(packet, true);
}

XpraClient.prototype._process_window_metadata = function(packet, ctx) {
	var wid = packet[1],
		metadata = packet[2],
		win = ctx.id_to_window[wid];
	if (win!=null) {
		win.update_metadata(metadata);
	}
}

XpraClient.prototype._process_initiate_moveresize = function(packet, ctx) {
    var wid = packet[1],
    	win = ctx.id_to_window[wid];
	if (win!=null) {
		var x_root = packet[2],
			y_root = packet[3],
			direction = packet[4],
			button = packet[5],
			source_indication = packet[6];
        win.initiate_moveresize(ctx.mousedown_event, x_root, y_root, direction, button, source_indication)
	}
}

XpraClient.prototype.on_last_window = function() {
	//this hook can be overriden
}

XpraClient.prototype._process_lost_window = function(packet, ctx) {
	var wid = packet[1];
	var win = ctx.id_to_window[wid];
	try {
		delete ctx.id_to_window[wid];
	}
	catch (e) {}
	if (win!=null) {
		win.destroy();
		console.log("lost window, was tray=", win.tray);
		if (win.tray) {
			//other trays may have moved:
			ctx.reconfigure_all_trays();
		}
	}
	console.log("lost window", wid, ", remaining: ", Object.keys(ctx.id_to_window));
	if (Object.keys(ctx.id_to_window).length==0) {
		ctx.on_last_window();
	}
}

XpraClient.prototype._process_raise_window = function(packet, ctx) {
	var wid = packet[1];
	var win = ctx.id_to_window[wid];
	if (win!=null) {
		ctx._window_set_focus(win);
	}
}

XpraClient.prototype._process_window_resized = function(packet, ctx) {
	var wid = packet[1];
	var width = packet[2];
	var height = packet[3];
	var win = ctx.id_to_window[wid];
	if (win!=null) {
		win.resize(width, height);
	}
}

XpraClient.prototype._process_window_move_resize = function(packet, ctx) {
	var wid = packet[1];
	var x = packet[2];
	var y = packet[3];
	var width = packet[4];
	var height = packet[5];
	var win = ctx.id_to_window[wid];
	if (win!=null) {
		win.move_resize(x, y, width, height);
	}
}

XpraClient.prototype._process_configure_override_redirect = function(packet, ctx) {
	var wid = packet[1];
	var x = packet[2];
	var y = packet[3];
	var width = packet[4];
	var height = packet[5];
	var win = ctx.id_to_window[wid];
	if (win!=null) {
		win.move_resize(x, y, width, height);
	}
}

XpraClient.prototype._process_desktop_size = function(packet, ctx) {
	//root_w, root_h, max_w, max_h = packet[1:5]
	//we don't use this yet,
	//we could use this to clamp the windows to a certain area
}

XpraClient.prototype._process_bell = function(packet, ctx) {
	var percent = packet[3];
	var pitch = packet[4];
	var duration = packet[5];
	if (ctx.audio_context!=null) {
		var oscillator = ctx.audio_context.createOscillator();
		var gainNode = ctx.audio_context.createGain();
		oscillator.connect(gainNode);
		gainNode.connect(ctx.audio_context.destination);
		gainNode.gain.setValueAtTime(percent, ctx.audio_context.currentTime);
		oscillator.frequency.setValueAtTime(pitch, ctx.audio_context.currentTime);
		oscillator.start();
		setTimeout(function(){oscillator.stop()}, duration);
	}
	else {
		var snd = new Audio("data:audio/wav;base64,//uQRAAAAWMSLwUIYAAsYkXgoQwAEaYLWfkWgAI0wWs/ItAAAGDgYtAgAyN+QWaAAihwMWm4G8QQRDiMcCBcH3Cc+CDv/7xA4Tvh9Rz/y8QADBwMWgQAZG/ILNAARQ4GLTcDeIIIhxGOBAuD7hOfBB3/94gcJ3w+o5/5eIAIAAAVwWgQAVQ2ORaIQwEMAJiDg95G4nQL7mQVWI6GwRcfsZAcsKkJvxgxEjzFUgfHoSQ9Qq7KNwqHwuB13MA4a1q/DmBrHgPcmjiGoh//EwC5nGPEmS4RcfkVKOhJf+WOgoxJclFz3kgn//dBA+ya1GhurNn8zb//9NNutNuhz31f////9vt///z+IdAEAAAK4LQIAKobHItEIYCGAExBwe8jcToF9zIKrEdDYIuP2MgOWFSE34wYiR5iqQPj0JIeoVdlG4VD4XA67mAcNa1fhzA1jwHuTRxDUQ//iYBczjHiTJcIuPyKlHQkv/LHQUYkuSi57yQT//uggfZNajQ3Vmz+Zt//+mm3Wm3Q576v////+32///5/EOgAAADVghQAAAAA//uQZAUAB1WI0PZugAAAAAoQwAAAEk3nRd2qAAAAACiDgAAAAAAABCqEEQRLCgwpBGMlJkIz8jKhGvj4k6jzRnqasNKIeoh5gI7BJaC1A1AoNBjJgbyApVS4IDlZgDU5WUAxEKDNmmALHzZp0Fkz1FMTmGFl1FMEyodIavcCAUHDWrKAIA4aa2oCgILEBupZgHvAhEBcZ6joQBxS76AgccrFlczBvKLC0QI2cBoCFvfTDAo7eoOQInqDPBtvrDEZBNYN5xwNwxQRfw8ZQ5wQVLvO8OYU+mHvFLlDh05Mdg7BT6YrRPpCBznMB2r//xKJjyyOh+cImr2/4doscwD6neZjuZR4AgAABYAAAABy1xcdQtxYBYYZdifkUDgzzXaXn98Z0oi9ILU5mBjFANmRwlVJ3/6jYDAmxaiDG3/6xjQQCCKkRb/6kg/wW+kSJ5//rLobkLSiKmqP/0ikJuDaSaSf/6JiLYLEYnW/+kXg1WRVJL/9EmQ1YZIsv/6Qzwy5qk7/+tEU0nkls3/zIUMPKNX/6yZLf+kFgAfgGyLFAUwY//uQZAUABcd5UiNPVXAAAApAAAAAE0VZQKw9ISAAACgAAAAAVQIygIElVrFkBS+Jhi+EAuu+lKAkYUEIsmEAEoMeDmCETMvfSHTGkF5RWH7kz/ESHWPAq/kcCRhqBtMdokPdM7vil7RG98A2sc7zO6ZvTdM7pmOUAZTnJW+NXxqmd41dqJ6mLTXxrPpnV8avaIf5SvL7pndPvPpndJR9Kuu8fePvuiuhorgWjp7Mf/PRjxcFCPDkW31srioCExivv9lcwKEaHsf/7ow2Fl1T/9RkXgEhYElAoCLFtMArxwivDJJ+bR1HTKJdlEoTELCIqgEwVGSQ+hIm0NbK8WXcTEI0UPoa2NbG4y2K00JEWbZavJXkYaqo9CRHS55FcZTjKEk3NKoCYUnSQ0rWxrZbFKbKIhOKPZe1cJKzZSaQrIyULHDZmV5K4xySsDRKWOruanGtjLJXFEmwaIbDLX0hIPBUQPVFVkQkDoUNfSoDgQGKPekoxeGzA4DUvnn4bxzcZrtJyipKfPNy5w+9lnXwgqsiyHNeSVpemw4bWb9psYeq//uQZBoABQt4yMVxYAIAAAkQoAAAHvYpL5m6AAgAACXDAAAAD59jblTirQe9upFsmZbpMudy7Lz1X1DYsxOOSWpfPqNX2WqktK0DMvuGwlbNj44TleLPQ+Gsfb+GOWOKJoIrWb3cIMeeON6lz2umTqMXV8Mj30yWPpjoSa9ujK8SyeJP5y5mOW1D6hvLepeveEAEDo0mgCRClOEgANv3B9a6fikgUSu/DmAMATrGx7nng5p5iimPNZsfQLYB2sDLIkzRKZOHGAaUyDcpFBSLG9MCQALgAIgQs2YunOszLSAyQYPVC2YdGGeHD2dTdJk1pAHGAWDjnkcLKFymS3RQZTInzySoBwMG0QueC3gMsCEYxUqlrcxK6k1LQQcsmyYeQPdC2YfuGPASCBkcVMQQqpVJshui1tkXQJQV0OXGAZMXSOEEBRirXbVRQW7ugq7IM7rPWSZyDlM3IuNEkxzCOJ0ny2ThNkyRai1b6ev//3dzNGzNb//4uAvHT5sURcZCFcuKLhOFs8mLAAEAt4UWAAIABAAAAAB4qbHo0tIjVkUU//uQZAwABfSFz3ZqQAAAAAngwAAAE1HjMp2qAAAAACZDgAAAD5UkTE1UgZEUExqYynN1qZvqIOREEFmBcJQkwdxiFtw0qEOkGYfRDifBui9MQg4QAHAqWtAWHoCxu1Yf4VfWLPIM2mHDFsbQEVGwyqQoQcwnfHeIkNt9YnkiaS1oizycqJrx4KOQjahZxWbcZgztj2c49nKmkId44S71j0c8eV9yDK6uPRzx5X18eDvjvQ6yKo9ZSS6l//8elePK/Lf//IInrOF/FvDoADYAGBMGb7FtErm5MXMlmPAJQVgWta7Zx2go+8xJ0UiCb8LHHdftWyLJE0QIAIsI+UbXu67dZMjmgDGCGl1H+vpF4NSDckSIkk7Vd+sxEhBQMRU8j/12UIRhzSaUdQ+rQU5kGeFxm+hb1oh6pWWmv3uvmReDl0UnvtapVaIzo1jZbf/pD6ElLqSX+rUmOQNpJFa/r+sa4e/pBlAABoAAAAA3CUgShLdGIxsY7AUABPRrgCABdDuQ5GC7DqPQCgbbJUAoRSUj+NIEig0YfyWUho1VBBBA//uQZB4ABZx5zfMakeAAAAmwAAAAF5F3P0w9GtAAACfAAAAAwLhMDmAYWMgVEG1U0FIGCBgXBXAtfMH10000EEEEEECUBYln03TTTdNBDZopopYvrTTdNa325mImNg3TTPV9q3pmY0xoO6bv3r00y+IDGid/9aaaZTGMuj9mpu9Mpio1dXrr5HERTZSmqU36A3CumzN/9Robv/Xx4v9ijkSRSNLQhAWumap82WRSBUqXStV/YcS+XVLnSS+WLDroqArFkMEsAS+eWmrUzrO0oEmE40RlMZ5+ODIkAyKAGUwZ3mVKmcamcJnMW26MRPgUw6j+LkhyHGVGYjSUUKNpuJUQoOIAyDvEyG8S5yfK6dhZc0Tx1KI/gviKL6qvvFs1+bWtaz58uUNnryq6kt5RzOCkPWlVqVX2a/EEBUdU1KrXLf40GoiiFXK///qpoiDXrOgqDR38JB0bw7SoL+ZB9o1RCkQjQ2CBYZKd/+VJxZRRZlqSkKiws0WFxUyCwsKiMy7hUVFhIaCrNQsKkTIsLivwKKigsj8XYlwt/WKi2N4d//uQRCSAAjURNIHpMZBGYiaQPSYyAAABLAAAAAAAACWAAAAApUF/Mg+0aohSIRobBAsMlO//Kk4soosy1JSFRYWaLC4qZBYWFRGZdwqKiwkNBVmoWFSJkWFxX4FFRQWR+LsS4W/rFRb/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////VEFHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU291bmRib3kuZGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMjAwNGh0dHA6Ly93d3cuc291bmRib3kuZGUAAAAAAAAAACU=");
		snd.play();
	}
	return;
}

/**
 * Notifications
 */
XpraClient.prototype._process_notify_show = function(packet, ctx) {
	//TODO: add UI switch to disable notifications
	//unused:
	//var dbus_id = packet[1];
	//var app_name = packet[3];
	//var app_icon = packet[5];
	var nid = packet[2];
	var replaces_nid = packet[4];
	var summary = packet[6];
	var body = packet[7];
	var expire_timeout = packet[8];
	var icon = packet[9];
	var actions = packet[10];
	var hints = packet[11];
	if(window.closeNotification) {
		if (replaces_nid>0) {
			window.closeNotification(replaces_nid);
		}
		window.closeNotification(nid);
	}
	if(window.doNotification) {
		window.doNotification("info", nid, summary, body, expire_timeout, icon, actions, hints,
				function(nid, action_id) {
					ctx.send(["notification-action", nid, action_id]);
				},
				function(nid, reason, text) {
					ctx.send(["notification-close", nid, reason, text || ""]);
				});
	}
	ctx._new_ui_event();
}

XpraClient.prototype._process_notify_close = function(packet, ctx) {
	nid = packet[1];
	if(window.closeNotification) {
		window.closeNotification(nid);
	}
}


/**
 * Cursors
 */
XpraClient.prototype.reset_cursor = function(packet, ctx) {
	for (var wid in ctx.id_to_window) {
		var window = ctx.id_to_window[wid];
		window.reset_cursor();
	}
	return;
}

XpraClient.prototype._process_cursor = function(packet, ctx) {
	if (packet.length==2) {
		ctx.reset_cursor(packet, ctx);
		return;
	}
	if (packet.length<9) {
		ctx.reset_cursor();
		return;
	}
	//we require a png encoded cursor packet:
	var encoding = packet[1];
	if (encoding!="png") {
		ctx.warn("invalid cursor encoding: "+encoding);
		return;
	}
	var w = packet[4];
	var h = packet[5];
	var xhot = packet[6];
	var yhot = packet[7];
	var img_data = packet[9];
	for (var wid in ctx.id_to_window) {
		var window = ctx.id_to_window[wid];
		window.set_cursor(encoding, w, h, xhot, yhot, img_data);
	}
}

XpraClient.prototype._process_window_icon = function(packet, ctx) {
	var wid = packet[1];
	var w = packet[2];
	var h = packet[3];
	var encoding = packet[4];
	var img_data = packet[5];
	ctx.debug("main", "window-icon: ", encoding, " size ", w, "x", h);
	var win = ctx.id_to_window[wid];
	if (win) {
		var src = win.update_icon(w, h, encoding, img_data);
		//update favicon too:
		if (wid==ctx.focus || ctx.server_is_desktop) {
			jQuery("#favicon").attr("href", src);
		}
	}
}

/**
 * Window Painting
 */
XpraClient.prototype._process_draw = function(packet, ctx) {
    if(ctx.queue_draw_packets){
        if (ctx.dQ_interval_id === null) {
            ctx.dQ_interval_id = setInterval(function(){
                ctx._process_draw_queue(null, ctx);
            }, ctx.process_interval);
        }
        ctx.dQ[ctx.dQ.length] = packet;
    } else {
        ctx._process_draw_queue(packet, ctx);
    }
}

XpraClient.prototype._process_eos = function(packet, ctx) {
	ctx._process_draw(packet, ctx);
}


XpraClient.prototype.request_redraw = function(win) {
	if (document.hidden) {
		this.debug("draw", "not redrawing, document.hidden=", document.hidden);
		return;
	}
	// request that drawing to screen takes place at next available opportunity if possible
	this.debug("draw", "request_redraw for", win);
	win.swap_buffers();
	if(window.requestAnimationFrame) {
		if (!this.pending_redraw.includes(win)) {
			this.pending_redraw.push(win);
		}
		// schedule a screen refresh if one is not already due:
		if (this.draw_pending==0) {
			var now = Utilities.monotonicTime();
			this.draw_pending = now;
			var me = this;
			window.requestAnimationFrame(function() {
				me.debug("draw", "animation frame:", me.pending_redraw.length, "windows to paint");
				me.draw_pending = 0;
				// draw all the windows in the list:
				while (me.pending_redraw.length>0) {
					var w = me.pending_redraw.shift();
					w.draw();
				}
			});
		}
	} else {
		// requestAnimationFrame is not available, draw immediately
		win.draw();
	}
}

XpraClient.prototype._process_draw_queue = function(packet, ctx){
    if(!packet && ctx.queue_draw_packets){
        packet = ctx.dQ.shift();
    }
    if(!packet){
        //no valid draw packet, likely handle errors for that here
        return;
    }
    var ptype = packet[0],
    	wid = packet[1];
	var win = ctx.id_to_window[wid];
    if (ptype=="eos") {
		ctx.debug("draw", "eos for window", wid);
    	if (win) {
    		win.eos();
    	}
    	return;
    }

    var start = Utilities.monotonicTime(),
		x = packet[2],
		y = packet[3],
		width = packet[4],
		height = packet[5],
		coding = packet[6],
		data = packet[7],
		packet_sequence = packet[8],
		rowstride = packet[9],
		options = {};
	if (packet.length>10)
		options = packet[10];
	var protocol = ctx.protocol;
	if (!protocol) {
		return;
	}
	function send_damage_sequence(decode_time, message) {
		protocol.send(["damage-sequence", packet_sequence, wid, width, height, decode_time, message]);
	}
	if (!win) {
		ctx.debug("draw", 'cannot paint, window not found:', wid);
		send_damage_sequence(-1, "window not found");
		return;
	}
	try {
		win.paint(x, y,
			width, height,
			coding, data, packet_sequence, rowstride, options,
			function (error) {
				var flush = options["flush"] || 0;
				var decode_time = -1;
				if(flush==0) {
					ctx.request_redraw(win);
				}
				if (error) {
					ctx.request_redraw(win);
				}
				else {
					decode_time = Math.round(Utilities.monotonicTime() - start);
				}
				ctx.debug("draw", "decode time for ", coding, " sequence ", packet_sequence, ": ", decode_time, ", flush=", flush);
				send_damage_sequence(decode_time, error || "");
			}
		);
	}
	catch(e) {
		ctx.error('error painting', coding, e);
		send_damage_sequence(-1, String(e));
		ctx.request_redraw(win);
	}
}


/**
 * Audio
 */
XpraClient.prototype.init_audio = function(ignore_audio_blacklist) {
	this.debug("audio", "init_audio() enabled=", this.audio_enabled, ", mediasource enabled=", this.audio_mediasource_enabled, ", aurora enabled=", this.audio_aurora_enabled, ", http-stream enabled=", this.audio_httpstream_enabled);
	if(!this.audio_enabled) {
		return;
	}
	if(this.audio_mediasource_enabled) {
		this.mediasource_codecs = MediaSourceUtil.getMediaSourceAudioCodecs(ignore_audio_blacklist);
		for (var codec_option in this.mediasource_codecs) {
			this.audio_codecs[codec_option] = this.mediasource_codecs[codec_option];
		}
	}
	if(this.audio_aurora_enabled) {
		this.aurora_codecs = MediaSourceUtil.getAuroraAudioCodecs();
		for (var codec_option in this.aurora_codecs) {
			if(codec_option in this.audio_codecs) {
				//we already have native MediaSource support!
				continue;
			}
			this.audio_codecs[codec_option] = this.aurora_codecs[codec_option];
		}
	}
	if (this.audio_httpstream_enabled) {
		var stream_codecs = ["mp3"];
		for (var i in stream_codecs) {
			var codec_option = stream_codecs[i];
			if (codec_option in this.audio_codecs) {
				continue;
			}
			this.audio_codecs[codec_option] = codec_option;
		}
	}
	this.debug("audio", "audio codecs:", this.audio_codecs);
	if(!this.audio_codecs) {
		this.audio_codec = null;
		this.audio_enabled = false;
		this.warn("no valid audio codecs found");
		return;
	}
	if(!(this.audio_codec in this.audio_codecs)) {
		if(this.audio_codec) {
			this.warn("invalid audio codec: "+this.audio_codec);
		}
		this.audio_codec = MediaSourceUtil.getDefaultAudioCodec(this.audio_codecs);
		if(this.audio_codec) {
			if(this.audio_mediasource_enabled && (this.audio_codec in this.mediasource_codecs)) {
				this.audio_framework = "mediasource";
			}
			else if (this.audio_aurora_enabled && !Utilities.isIE()) {
				this.audio_framework = "aurora";
			}
			else if (this.audio_httpstream_enabled) {
				this.audio_framework = "http-stream";
			}
			if (this.audio_framework) {
				this.log("using "+this.audio_framework+" audio codec: "+this.audio_codec);
			}
			else {
				this.warn("no valid audio framework - cannot enable audio");
				this.audio_enabled = false;
			}
		}
		else {
			this.warn("no valid audio codec found");
			this.audio_enabled = false;
		}
	}
	else {
		this.log("using "+this.audio_framework+" audio codec: "+this.audio_codec);
	}
	this.log("audio codecs: ", Object.keys(this.audio_codecs));
}

XpraClient.prototype._sound_start_receiving = function() {
	try {
		this.audio_buffers = [];
		this.audio_buffers_count = 0;
		if (this.audio_framework=="http-stream") {
			this._sound_start_httpstream();
		}
		else if (this.audio_framework=="mediasource") {
			this._sound_start_mediasource();
		}
		else {
			this._sound_start_aurora();
		}
	}
	catch(e) {
		this.error('error starting audio player: '+e);
	}
}


XpraClient.prototype._send_sound_start = function() {
	this.log("audio: requesting "+this.audio_codec+" stream from the server");
	this.send(["sound-control", "start", this.audio_codec]);
}


XpraClient.prototype._sound_start_httpstream = function() {
	this.audio = document.createElement("audio");
	this.audio.setAttribute('autoplay', true);
	this.audio.setAttribute('controls', false);
	this.audio.setAttribute('loop', true);
	var url = "http";
	if (this.ssl) {
		url = "https";
	}
	url += "://"+this.host+":"+this.port;
	if (this.path) {
		url += "/"+this.path;
	}
	url += "/audio.mp3?uuid="+this.uuid;
	this.log("starting http stream from", url);
	this.audio.src = url;
}

XpraClient.prototype._sound_start_aurora = function() {
	this.audio_aurora_ctx = AV.Player.fromXpraSource();
	this._send_sound_start();
}

XpraClient.prototype._sound_start_mediasource = function() {
	var me = this;

	function audio_error(event) {
		if(me.audio) {
			me.error(event+" error: "+me.audio.error);
			if(me.audio.error) {
				me.error(MediaSourceConstants.ERROR_CODE[me.audio.error.code]);
			}
		}
		else {
			me.error(event+" error");
		}
		me.close_audio();
	}

	//Create a MediaSource:
	this.media_source = MediaSourceUtil.getMediaSource();
	if(this.debug) {
		MediaSourceUtil.addMediaSourceEventDebugListeners(this.media_source, "audio");
	}
	this.media_source.addEventListener('error', 	function(e) {audio_error("audio source"); });

	//Create an <audio> element:
	this.audio = document.createElement("audio");
	this.audio.setAttribute('autoplay', true);
	if(this.debug) {
		MediaSourceUtil.addMediaElementEventDebugListeners(this.audio, "audio");
	}
	this.audio.addEventListener('play', 			function() { console.log("audio play!"); });
	this.audio.addEventListener('error', 			function() { audio_error("audio"); });
	document.body.appendChild(this.audio);

	//attach the MediaSource to the <audio> element:
	this.audio.src = window.URL.createObjectURL(this.media_source);
	this.audio_buffers = []
	this.audio_buffers_count = 0;
	this.audio_source_ready = false;
	console.log("audio waiting for source open event on "+this.media_source);
	this.media_source.addEventListener('sourceopen', function() {
		me.log("audio media source open");
		if (me.audio_source_ready) {
			me.warn("ignoring: source already open");
			return;
		}
		//ie: codec_string = "audio/mp3";
		var codec_string = MediaSourceConstants.CODEC_STRING[me.audio_codec];
		if(codec_string==null) {
			me.error("invalid codec '"+me.audio_codec+"'");
			me.close_audio();
			return;
		}
		me.log("using audio codec string for "+me.audio_codec+": "+codec_string);

		//Create a SourceBuffer:
		var asb = null;
		try {
			asb = me.media_source.addSourceBuffer(codec_string);
		} catch (e) {
			me.error("audio setup error for '"+codec_string+"':", e);
			me.close_audio();
			return;
		}
		me.audio_source_buffer = asb;
		asb.mode = "sequence";
		if (this.debug) {
			MediaSourceUtil.addSourceBufferEventDebugListeners(asb, "audio");
		}
		asb.addEventListener('error', 				function(e) { audio_error("audio buffer"); });
		me.audio_source_ready = true;
		me._send_sound_start();
	});
}

XpraClient.prototype.close_audio = function() {
	if (this.protocol) {
		this.send(["sound-control", "stop"]);
	}
	if (this.audio_framework=="http-stream") {
		this._close_audio_httpstream();
	}
	else if (this.audio_framework=="mediasource") {
		this._close_audio_mediasource();
	}
	else {
		this._close_audio_aurora();
	}
}

XpraClient.prototype._close_audio_httpstream = function() {
	this._remove_audio_element();
}

XpraClient.prototype._close_audio_aurora = function() {
	if(this.audio_aurora_ctx) {
		//this.audio_aurora_ctx.close();
		this.audio_aurora_ctx = null;
	}
}

XpraClient.prototype._close_audio_mediasource = function() {
	this.log("close_audio_mediasource: audio_source_buffer="+this.audio_source_buffer+", media_source="+this.media_source+", video="+this.audio);
	this.audio_source_ready = false;
	if(this.audio) {
		this.send(["sound-control", "stop"]);
		if(this.media_source) {
			try {
				if(this.audio_source_buffer) {
					this.media_source.removeSourceBuffer(this.audio_source_buffer);
					this.audio_source_buffer = null;
				}
				if(this.media_source.readyState=="open") {
					this.media_source.endOfStream();
				}
			} catch(e) {
				this.warn("audio media source EOS error:", e);
			}
			this.media_source = null;
		}
		this._remove_audio_element();
	}
}

XpraClient.prototype._remove_audio_element = function() {
	if (this.audio) {
		this.audio.src = "";
		this.audio.load();
		try {
			document.body.removeChild(this.audio);
		}
		catch (e) {
			this.debug("audio", "failed to remove audio from page:", e);
		}
		this.audio = null;
	}
}

XpraClient.prototype._process_sound_data = function(packet, ctx) {
	if (packet[1]!=ctx.audio_codec) {
		ctx.error("invalid audio codec '"+packet[1]+"' (expected "+ctx.audio_codec+"), stopping audio stream");
		ctx.close_audio();
		return;
	}

	try {
		var codec = packet[1];
		var buf = packet[2];
		var options = packet[3];
		var metadata = packet[4];

		if (options["start-of-stream"] == 1) {
			ctx._audio_start_stream();
			return;
		}
		if (options["end-of-stream"] == 1) {
			ctx.log("received end-of-stream from server");
			ctx.close_audio();
		}

		ctx.add_sound_data(codec, buf, metadata);
	}
	catch(e) {
		this.on_audio_state_change("error", ""+e);
		this.error("audio failed:", e);
		this.close_audio();
	}
}

XpraClient.prototype.on_audio_state_change = function(newstate, details) {
	//can be overriden
}

XpraClient.prototype.add_sound_data = function(codec, buf, metadata) {
	var MIN_START_BUFFERS = 4;
	var MAX_BUFFERS = 250;
	this.debug("audio", "sound-data: ", codec, ", ", buf.length, "bytes");
	if (this.audio_buffers.length>=MAX_BUFFERS) {
		this.warn("audio queue overflowing: "+this.audio_buffers.length+", stopping");
		this.on_audio_state_change("error", "queue overflow");
		this.close_audio();
		return;
	}
	if (metadata) {
		this.debug("audio", "audio metadata=", metadata);
		//push metadata first:
		for (var i = 0; i < metadata.length; i++) {
			this.debug("audio", "metadata[", i, "]=", metadata[i], ", length=", metadata[i].length, ", type=", Object.prototype.toString.call(metadata[i]));
			this.audio_buffers.push(Utilities.StringToUint8(metadata[i]));
		}
		//since we have the metadata, we should be good to go:
		MIN_START_BUFFERS = 1;
	}
	if (buf != null) {
		this.audio_buffers.push(buf);
	}
	var ab = this.audio_buffers;
	if (this._audio_ready() && (this.audio_buffers_count>0 || ab.length >= MIN_START_BUFFERS)) {
		if (ab.length==1) {
			//shortcut
			buf = ab[0];
		}
		else {
			//concatenate all pending buffers into one:
			var size = 0;
			for (var i=0,j=ab.length;i<j;++i) {
				size += ab[i].length;
			}
			buf = new Uint8Array(size);
			size = 0;
			for (var i=0,j=ab.length;i<j;++i) {
				var v = ab[i];
				if (v.length>0) {
					buf.set(v, size);
					size += v.length;
				}
			}
		}
		this.audio_buffers_count += 1;
		this.audio_buffers = [];
		this.push_audio_buffer(buf);
	}
}

XpraClient.prototype._audio_start_stream = function() {
	this.debug("audio", "audio start of "+this.audio_framework+" "+this.audio_codec+" stream");
	if (this.audio_framework=="mediasource") {
		this.audio.play();
	}
	else {
		this.audio_aurora_ctx.play();
	}
	this.on_audio_state_change("playing", ""+this.audio_framework+" playing "+this.audio_codec+" stream");
}

XpraClient.prototype._audio_ready = function() {
	if (this.audio_framework=="mediasource") {
		//check media source buffer state:
		this.debug("audio", "mediasource state=", MediaSourceConstants.READY_STATE[this.audio.readyState], ", network state=", MediaSourceConstants.NETWORK_STATE[this.audio.networkState]);
		this.debug("audio", "audio paused=", this.audio.paused, ", queue size=", this.audio_buffers.length, ", source ready=", this.audio_source_ready, ", source buffer updating=", this.audio_source_buffer.updating);
		var asb = this.audio_source_buffer;
		return (asb!=null) && (!asb.updating);
	}
	else {
		return (this.audio_aurora_ctx!=null);
	}
}

XpraClient.prototype.push_audio_buffer = function(buf) {
	if (this.audio_framework=="mediasource") {
		this.audio_source_buffer.appendBuffer(buf);
	}
	else {
		this.audio_aurora_ctx.asset.source._on_data(buf);
	}
}


/**
 * Clipboard
 */
XpraClient.prototype.get_clipboard_buffer = function() {
	return this.clipboard_buffer;
}

XpraClient.prototype.send_clipboard_token = function(data) {
	if (!this.clipboard_enabled) {
		return;
	}
	this.debug("keyboard", "sending clipboard token with data:", data);
	var packet = ["clipboard-token", "CLIPBOARD", [], "STRING", "STRING", data.length, "bytes", data, false, true, true];
	this.send(packet);
}

XpraClient.prototype._process_clipboard_token = function(packet, ctx) {
	if (!ctx.clipboard_enabled) {
		return;
	}
	ctx.debug("clipboard", "clipboard token:", packet);
	// we don't actually set the clipboard here,
	// because we can't (the browser security won't let us)
	// we just record the contents and actually set the clipboard
	// when we get a click, control-C or control-X event
	if(ctx.clipboard_targets.indexOf(packet[3])>=0) {
		var data = packet[7];
		try {
			data = Utilities.Uint8ToString(data);
		}
		catch (e) { }
		if (ctx.clipboard_buffer!=data) {
			ctx.clipboard_buffer = data;
			ctx.clipboard_pending = true;
		}
	}
}

XpraClient.prototype._process_set_clipboard_enabled = function(packet, ctx) {
	if (!ctx.clipboard_enabled) {
		return;
	}
	ctx.clipboard_enabled = packet[1];
	ctx.log("server set clipboard state to "+packet[1]+" reason was: "+packet[2]);
}

XpraClient.prototype._process_clipboard_request = function(packet, ctx) {
	// we shouldn't be handling clipboard requests,
	// since we use a synchronous clipboard,
	// but older servers may still request it..
	var request_id = packet[1],
		selection = packet[2];
		//target = packet[3];

	var packet;
	var clipboard_buffer = ctx.get_clipboard_buffer();
	if(clipboard_buffer == "") {
		packet = ["clipboard-contents-none", request_id, selection];
	} else {
		packet = ["clipboard-contents", request_id, selection, "UTF8_STRING", 8, "bytes", clipboard_buffer];
	}
	ctx.send(packet);
}

/**
 * File transfers and printing
 */
XpraClient.prototype._process_send_file = function(packet, ctx) {
	var basefilename = packet[1];
	var mimetype = packet[2];
	var printit = packet[3];
	var datasize = packet[5];
	var data = packet[6];

	// check the data size for file
	if(data.length != datasize) {
		ctx.warn("send-file: invalid data size, received", data.length, "bytes, expected", datasize);
		return;
	}
	if (printit) {
		ctx.print_document(basefilename, data, mimetype);
	}
	else {
		ctx.save_file(basefilename, data, mimetype);
	}
}

XpraClient.prototype.save_file = function(filename, data, mimetype) {
	if (!this.file_transfer || !this.remote_file_transfer) {
		this.warn("Received file-transfer data but this is not enabled!");
		return;
	}
	if (mimetype == "") {
		mimetype = "application/octet-binary";
	}
	this.log("saving "+data.length+" bytes of "+mimetype+" data to filename "+filename);
	Utilities.saveFile(filename, data, {type : mimetype});
}

XpraClient.prototype.print_document = function(filename, data, mimetype) {
	if (!this.printing || !this.remote_printing) {
		this.warn("Received data to print but printing is not enabled!");
		return;
	}
	if (mimetype != "application/pdf") {
		this.warn("Received unsupported print data mimetype: "+mimetype);
		return;
	}
	this.log("got "+data.length+" bytes of PDF to print");
	var b64data = btoa(uintToString(data));
	var win = window.open(
			'data:application/pdf;base64,'+b64data,
			'_blank'
	);
	if (!win || win.closed || typeof win.closed=='undefined') {
		this.warn("popup blocked, saving to file instead");
		Utilities.saveFile(filename, data, {type : mimetype});
	}
}

XpraClient.prototype.send_file = function(filename, mimetype, size, buffer) {
	if (!this.file_transfer || !this.remote_file_transfer) {
		this.warn("cannot send file: file transfers are disabled!");
		return;
	}
	var packet = ["send-file", filename, mimetype, false, this.remote_open_files, size, buffer, {}];
	this.send(packet);
}

XpraClient.prototype._process_open_url = function(packet, ctx) {
    var url = packet[1];
    //var send_id = packet[2];
    if (!ctx.open_url) {
        console.warn("Warning: received a request to open URL '%s'", url);
        console.warn(" but opening of URLs is disabled");
        return
    }
    $('#action-link').attr("href", url);
    $('#action-link').text(url);
    $('#action-link').show();
    console.log("opening url:", url);
}
