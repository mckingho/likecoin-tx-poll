/* eslint no-await-in-loop: off */

const Web3 = require('web3');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const config = require('./config.js');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const web3 = new Web3(new Web3.providers.HttpProvider(`https://${config.NETWORK}.infura.io/ywCD9mvUruQeYcZcyghk`));

const STATUS_FAIL = 'fail';
const STATUS_SUCCESS = 'success';
const STATUS_TIMEOUT = 'timeout';

function sleep(ms) {
  return new global.Promise(resolve => setTimeout(resolve, ms));
}

const txQueue = [];

async function startWatcher() {
  for (;;) {
    const loopTime = Date.now();
    const tx = txQueue.shift();
    if (tx) {
      const { txHash, timestamp, cb } = tx;
      try {
        const receipt = await web3.eth.getTransactionReceipt(txHash);
        if (!receipt) {
          if (Date.now() - timestamp > config.TIME_LIMIT) {
            cb(STATUS_TIMEOUT, tx);
          } else {
            // wait for retry
            setTimeout(() => txQueue.push(tx), config.TX_LOOP_INTERVAL);
          }
        } else if (Number.parseInt(receipt.status, 16) === 1) {
          cb(STATUS_SUCCESS, tx, receipt);
        } else {
          cb(STATUS_FAIL, tx, receipt);
        }
      } catch (err) {
        console.error(err); // eslint-disable-line no-console
      }
    }
    const timeUsed = Date.now() - loopTime;
    if (timeUsed < config.FETCH_INTERVAL) {
      await sleep(config.FETCH_INTERVAL - timeUsed);
    }
  }
}

function watchTx(txHash, cb) {
  txQueue.push({ txHash, timestamp: Date.now(), cb });
}

function statusCallback(status, tx) {
  db.collection(config.FIRESTORE_TX_ROOT).doc(tx.txHash).update({ status });
  // TODO: log through pubsub
}

function main() {
  const txRef = db.collection(config.FIRESTORE_TX_ROOT);
  txRef.where('status', '==', 'pending').onSnapshot((snapshot) => {
    snapshot.docChanges.filter(change => change.type === 'added').forEach((change) => {
      const txHash = change.doc.id;
      watchTx(txHash, statusCallback);
    });
  });
  startWatcher();
}

main();

// vim: set ts=2 sw=2:
