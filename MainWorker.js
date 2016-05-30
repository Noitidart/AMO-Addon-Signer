// Imports
importScripts('resource://gre/modules/osfile.jsm');
importScripts('chrome://amo-addon-signer/content/hmac-sha256.js');
importScripts('chrome://amo-addon-signer/content/enc-base64-min.js');
importScripts('chrome://amo-addon-signer/content/jszip.min.js');

// Globals
const AMODOMAIN = 'https://addons.mozilla.org';
var gLastSystemTimeOffset = 0;

// Functionality

// start - jwt token gen
function jwtSignOlympia(aKey, aSecret, aDateMs) {
	// aKey and aSecret should both be strings
	// jwt signature function for using with signing addons on AMO (addons.mozilla.org)
	var part1 = b64utoa(JSON_stringify_sorted({
		typ: 'JWT',
		alg: 'HS256'
	}));

	var iat = Math.ceil(aDateMs / 1000); // in seconds
	var part2 = b64utoa(JSON_stringify_sorted({
		iss: aKey,
		jti: Math.random().toString(),
		iat,
		exp: iat + 60
	}));

	var part3 = CryptoJS.HmacSHA256(part1 + '.' + part2, aSecret).toString(CryptoJS.enc.Base64).replace(/\=+$/m, '');
	return part1 + '.' + part2 + '.' + part3;
}
// end - jwt token gen

function signUnsignedXpi(path, amo_key, amo_secret) {

	// access the file on filesystem
	var unsigned_uint8;
	try {
		unsigned_uint8 = OS.File.read(path);
	} catch (ex) {
		console.error('failed to read file at path:', path);
		throw new Error('failed to read file at path');
	}

	if (unsigned_uint8) {

		// read the file as a zip
		var unsigned_jszip = new JSZip(unsigned_uint8.buffer);

		// extract xpi id and version
		var manifest = JSON.parse(unsigned_jszip.file('manifest.json').asText());

		try {
			var xpiid = manifest.applications.gecko.id;
		} catch(ex) {
			console.error('failed to extract applications.gecko.id from manfiest');
			throw new Error('failed to extract applications.gecko.id from manfiest');
		}
		try {
			var xpiversion = manifest.version;
		} catch(ex) {
			console.error('failed to extract version from manfiest');
			throw new Error('failed to extract version from manfiest');
		}

		// start - async-proc25830
		var systemTimeOffset; // in milliseconds
		var requestUnixTimeFromServer = function() {
			// get offset of system clock to unix clock
				// if server1 fails use server2. if server2 fails continue with system clock (possible last globally stored offset - think about it)

			// start async-proc94848
			var requestStart; // start time of request
			var asyncProc94848 = function() {
				tryServer1();
			};

			var tryServer1 = function() {
				console.log('get unix time from server 1');
				requestStart = Date.now();
				xhrAsync('http://currenttimestamp.com/', {
					timeout: 10000
				}, callbackServer1);
			};

			var callbackServer1 = function(xhrArg) {
				var { request, ok, reason } = xhrArg;

				var onFail = function() {
					tryServer2();
				};

				if (!ok) {
					onFail();
				} else {
					var requestEnd = Date.now();
					var requestDuration = requestEnd - requestStart;
					var html = request.response;

					// start - calc sys offset
					var nowDateServerMatch = /current_time = (\d+);/.exec(html);
					if (!nowDateServerMatch) {
						onFail();
					}
					// console.log('nowDateServerMatch:', nowDateServerMatch);

					var nowDateServerUncompensated = parseInt(nowDateServerMatch[1]) * 1000;
					// console.log('nowDateServerUncompensated:', nowDateServerUncompensated);

					var nowDateServer = nowDateServerUncompensated - requestDuration;
					// console.log('nowDateServer:', nowDateServer);

					// console.log('systemNow:', (new Date(requestStart)).toLocaleString(), 'serverNow:', (new Date(nowDateServer)).toLocaleString(), 'requestDuration seconds:', (requestDuration / 1000))
					systemTimeOffset = requestStart - nowDateServer;
					gLastSystemTimeOffset = systemTimeOffset;
					// end - calc sys offset

					initiateUpload();
				}
			};

			var tryServer2 = function() {
				console.log('get unix time from server 2, becuase server 1 was down');
				requestStart = Date.now();
				xhrAsync('http://convert-unix-time.com/', {
					timeout: 10000
				}, callbackServer2);
			};

			var callbackServer2 = function(xhrArg) {
				var { request, ok, reason } = xhrArg;

				var onFail = function() {
					// rely on whatever gLastSystemTimeOffset is
					initiateUpload();
				};

				if (!ok) {
					onFail();
				} else {
					var requestEnd = Date.now();
					var requestDuration = requestEnd - requestStart;
					var html = request.response;


					// start - calc sys offset
					var nowDateServerMatch = /Seconds since 1970 (\d+)/.exec(html);
					if (!nowDateServerMatch) {
						onFail();
					}
					// console.log('nowDateServerMatch:', nowDateServerMatch);

					var nowDateServerUncompensated = parseInt(nowDateServerMatch[1]) * 1000;
					// console.log('nowDateServerUncompensated:', nowDateServerUncompensated);

					var nowDateServer = nowDateServerUncompensated - requestDuration;
					// console.log('nowDateServer:', nowDateServer);

					// console.log('systemNow:', (new Date(requestStart)).toLocaleString(), 'serverNow:', (new Date(nowDateServer)).toLocaleString(), 'requestDuration seconds:', (requestDuration / 1000))
					systemTimeOffset = requestStart - nowDateServer;
					gLastSystemTimeOffset = systemTimeOffset;
					// end - calc sys offset

					afterSystemTimeOffsetGot();
				}
			};

			asyncProc94848();
			// end - async-proc94848
		};

		var getCorrectedSystemTime = ()=>(Date.now() - systemTimeOffset);
		var initiateUpload = function() {
			console.log('submitting upload - ', AMODOMAIN + '/api/v3/addons/' + encodeURIComponent(xpiid) + '/versions/' + xpiversion + '/');

			var unsigned_domfile = new File([new Blob([unsigned_uint8.buffer], {type:'application/zip'})], 'dummyname.xpi');
			var data = new FormData();
			data.append('Content-Type', 'multipart/form-data');
			data.append('upload', unsigned_domfile);
			xhrAsync(AMODOMAIN + '/api/v3/addons/' + encodeURIComponent(xpiid) + '/versions/' + xpiversion + '/', { // only on first time upload, the aAddonVersionInXpi can be anything
				method: 'PUT',
				data,
				responseType: 'json',
				headers: {
					Authorization: 'JWT ' + jwtSignOlympia(amo_key, amo_secret, getCorrectedSystemTime())
				},
				// timout: null - DO NOT set timeout, as the signature expiry will tell us of timeout link88444576
				// onprogress
			}, verifyUploaded);

		};

		var possible_uploadFailedDueToTooLong_if404onCheck = false;
		var verifyUploaded = function(xhrArg) {
			var { request, ok, reason } = xhrArg;
			var { status, statusText, response } = request;
			console.log('submit response:', { status, statusText, response });

			switch (status) {
				case 201:
					console.log('GOOD - new addon accepted');
					requestReviewStatus(); // wait for review to complete
					break;
				case 202:
					console.log('GOOD - new version of existing addon accepted');
					requestReviewStatus(); // wait for review to complete
					break;
				case 409:
					console.log('WARN - addon with this id and version is already there, will go to download');
					requestReviewStatus(); // get download url
					break;
				default:
					console.error('ERROR - unhandled status code');
			}
		};

		var request_status_cnt = 0;
		var requestReviewStatus = function() {
			// sends xhr to check if review is complete - and gets download url
			request_status_cnt++;
			console.log('making request for addon status:', AMODOMAIN + '/api/v3/addons/' + encodeURIComponent(xpiid) + '/versions/' + xpiversion + '/');
			xhrAsync(AMODOMAIN + '/api/v3/addons/' + encodeURIComponent(xpiid) + '/versions/' + xpiversion + '/', {
				responseType: 'json',
				headers: {
					Authorization: 'JWT ' + jwtSignOlympia(amo_key, amo_secret, getCorrectedSystemTime())
				}
			}, callbackReviewStatus);
		};

		var callbackReviewStatus = function(xhrArg) {
			var { request, ok, reason } = xhrArg;
			var { status, statusText, response } = request;
			console.log('review status check response:', { status, statusText, response });

			switch (status) {
				case 200:
					// ok succesfully got back check response - lets see if (1) review incomplete or complete (2) if so then if rejected/approved

						// state changes of reponse.jon for eventual approved
						// active=false	processed=false	passed_review=false	files=[0]	reviewed=false	validation_results=null		valid:false	// immediately after upload
						// active=false	processed=true	passed_review=false	files=[0]	reviewed=false	validation_results={...}	valid:true 	// processing complete - takes some time
						// active=true	processed=true	passed_review=true	files=[1]	reviewed=true	validation_results={...}	valid:true 	// approved and file ready to download - takes some time

						// TODO: state changes of reponse.jon for eventual rejected
						// TODO: state changes of reponse.jon for eventual other non-approved (like error)

						if (request.response.files.length === 1) {
							// ok review complete and approved - download it
							console.log('GOOD - ok review completed and submission approved - downloading to desktop - ', request.response.files[0].download_url);
							xhrAsync(request.response.files[0].download_url, {
								responseType: 'arraybuffer',
								headers: {
									Authorization: 'JWT ' + jwtSignOlympia(amo_key, amo_secret, getCorrectedSystemTime())
								}
							}, callbackDownloadSigned);
						} else if (request.response.files.length === 0) {

							if (request.response.reviewed && !request.response.passed_review) { // i was using .response.processed however it was not right, as it gets processed before reviewed. so updated to .response.reviewed. as with fullscreenshot thing i got that warning for binary - https://chrome.google.com/webstore/detail/full-page-screen-capture/fdpohaocaechififmbbbbbknoalclacl
								console.error('GOOD - review was completed, however the submission was rejected');
							} else {
								// review is in process, check again after waiting
								console.log('OK - addon not yet signed, will wait 10sec, then check again...');
								setTimeout(requestReviewStatus, 10000);
							}
						} else {
							// files are > 1 - how on earth?? // TODO: handle this with error to user
						}

					break;
				case 404:
					console.error('ERROR - no addon with this id and version was ever uploaded');
					break;
				default:
					console.error('ERROR - unhandled status code');
			}
		};

		var callbackDownloadSigned = function(xhrArg) {
			var { request, ok, reason } = xhrArg;
			var { status, statusText, response } = request;
			console.log('download response:', { status, statusText, response });

			switch (status) {
				case 200:
					console.log('GOOD - downloaded data, saving signed xpi to desktop');
					try {
						OS.File.writeAtomic(OS.Path.join(OS.Constants.Path.desktopDir, 'signed.xpi'), new Uint8Array(request.response));
					} catch(ex) {
						console.error('ERROR - failed when trying to save to desktop as signed.xpi');
					}
					console.log('GOOD - saved to desktop as signed.xpi');
					break;
				default:
					console.error('ERROR - unhandled status code when trying to download');
			}
		};

		requestUnixTimeFromServer();
		// end - async-proc25830

	}

}


// start - common helper function
function xhrAsync(aUrlOrFileUri, aOptions={}, aCallback) { // 052716 - added timeout support
	// console.error('in xhr!!! aUrlOrFileUri:', aUrlOrFileUri);

	// all requests are sync - as this is in a worker
	var aOptionsDefaults = {
		responseType: 'text',
		timeout: 0, // integer, milliseconds, 0 means never timeout, value is in milliseconds
		headers: null, // make it an object of key value pairs
		method: 'GET', // string
		data: null, // make it whatever you want (formdata, null, etc), but follow the rules, like if aMethod is 'GET' then this must be null
		onprogress: undefined // set to callback you want called
	};
	Object.assign(aOptionsDefaults, aOptions);
	aOptions = aOptionsDefaults;

	var request = new XMLHttpRequest();

	request.timeout = aOptions.timeout;

	var handler = ev => {
		evf(m => request.removeEventListener(m, handler, !1));

		switch (ev.type) {
			case 'load':

					aCallback({request, ok:true});
					// if (xhr.readyState == 4) {
					// 	if (xhr.status == 200) {
					// 		deferredMain_xhr.resolve(xhr);
					// 	} else {
					// 		var rejObj = {
					// 			name: 'deferredMain_xhr.promise',
					// 			aReason: 'Load Not Success', // loaded but status is not success status
					// 			xhr: xhr,
					// 			message: xhr.statusText + ' [' + ev.type + ':' + xhr.status + ']'
					// 		};
					// 		deferredMain_xhr.reject(rejObj);
					// 	}
					// } else if (xhr.readyState == 0) {
					// 	var uritest = Services.io.newURI(aStr, null, null);
					// 	if (uritest.schemeIs('file')) {
					// 		deferredMain_xhr.resolve(xhr);
					// 	} else {
					// 		var rejObj = {
					// 			name: 'deferredMain_xhr.promise',
					// 			aReason: 'Load Failed', // didnt even load
					// 			xhr: xhr,
					// 			message: xhr.statusText + ' [' + ev.type + ':' + xhr.status + ']'
					// 		};
					// 		deferredMain_xhr.reject(rejObj);
					// 	}
					// }

				break;
			case 'abort':
			case 'error':
			case 'timeout':

					// var result_details = {
					// 	reason: ev.type,
					// 	request,
					// 	message: request.statusText + ' [' + ev.type + ':' + request.status + ']'
					// };
					aCallback({request:request, ok:false, reason:ev.type});

				break;
			default:
				var result_details = {
					reason: 'unknown',
					request,
					message: request.statusText + ' [' + ev.type + ':' + request.status + ']'
				};
				aCallback({xhr:request, ok:false, result_details});
		}
	};


	var evf = f => ['load', 'error', 'abort', 'timeout'].forEach(f);
	evf(m => request.addEventListener(m, handler, false));

	if (aOptions.onprogress) {
		request.addEventListener('progress', aOptions.onprogress, false);
	}
	request.open(aOptions.method, aUrlOrFileUri, true); // 3rd arg is false for async

	if (aOptions.headers) {
		for (var h in aOptions.headers) {
			request.setRequestHeader(h, aOptions.headers[h]);
		}
	}

	request.responseType = aOptions.responseType;
	request.send(aOptions.data);

	// console.log('response:', request.response);

	// console.error('done xhr!!!');

}
function b64utoa(aStr) {
	// base64url encode
	return btoa(aStr)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/\=+$/m, '')
}

function JSON_stringify_sorted(aObj) {
	var keys = Object.keys(aObj);
	keys.sort();
	var strArr = [];
	var l = keys.length;
	for(var i = 0; i < l; i++) {
		var stry = JSON.stringify({
			[keys[i]]: aObj[keys[i]]
		});
		stry = stry.substr(1, stry.length - 2); // remove the opening and closing curly
		strArr.push(stry);
	}
	return '{' + strArr.join(',') + '}'
}
// end - common helper function

console.log('ok mainworker ready');
