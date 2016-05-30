// Imports

// Globals
var core = {
	addon: {
		name: 'AMO Addon Signer',
		id: 'amo-addon-signer@jetpack',
		path: {
			name: 'amo-addon-signer',
			//
			content: 'chrome://amo-addon-signer/content/'
		}
	}
};
var MainWorker;

// bootstrap
function install() {}
function uninstall() {}

function startup() {

	MainWorker = new ChromeWorker(core.addon.path.content + 'MainWorker.js');

	console.log('ok bootstrap ready');
}

function shutdown(aData, aReason) {

	if (aReason == APP_SHUTDOWN) { return }

	MainWorker.terminate();

}
