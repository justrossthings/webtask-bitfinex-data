'use strict';
'use latest';
const BFX = require('bitfinex-api-node');
const _ = require('lodash');
const async = require('async');

let taskName;
const symbols = [
  'btcusd',
  'ltcusd',
  'ethusd',
  'bchusd',
  'neousd',
  'xrpusd',
  'iotusd',
  'etcusd',
  'rrtusd',
  'zecusd',
  'eosusd',
  'sanusd',
  'omgusd',
  'xmrusd',
  'dshusd',
  'bccusd',
  'bcuusd',
  'etpusd',
  'qtmusd',
  'bt1usd',
  'bt2usd',
  'avtusd',
  'edousd',
  'btgusd',
  'datusd',
  'qshusd',
  'yywusd',
];
const symbolsLen = symbols.length;
const symbolsGroups = [
  symbols.slice(0, 10),
  symbols.slice(10, 20),
  symbols.slice(20, symbolsLen),
];

module.exports = async function (ctx, cb) {
  const apiKey = ctx.secrets.BITFINEX_API_KEY;
  const apiSecret = ctx.secrets.BITFINEX_API_SECRET;
  const bfxRest = new BFX(apiKey, apiSecret, { version: 1 }).rest;
  
  const getStore = () => new Promise((resolve, reject) => {
    ctx.storage.get((err, data) => {
      if (err) {
        console.log(`${taskName} GET_STORE_ERROR:`);
        reject(err);
      }
      const store = data || {};
      resolve(store);
    });
  });
  
  const setStore = (newStore) => new Promise((resolve, reject) => {
    ctx.storage.set(newStore, err => {
      if (err) {
        console.log(`${taskName} SET_STORE_ERROR:`);
        reject(err);
      }
      resolve(newStore);
    });
  });
  
  async function getRates(groupNumber) {
    console.log(`${taskName} GETTING_RATES_FOR_GROUP${groupNumber}`);
    const symbolGroup = symbolsGroups[groupNumber];
    const buildRates = () => new Promise((resolve, reject) => {
      async.mapValues(symbolGroup, (symbol, key, acb) => {
        console.log(`${taskName} GETTING_RATE: ${symbol}`);
        bfxRest.ticker(symbol, (err, res) => {
          if (err) {
            acb(err);
          } else {
            const rate = res.last_price;
            acb(null, rate);
          }
        })
      }, (err, results) => {
        if (err) {
          reject(err);
        } else {
          let newRatesObj = {};
          _.forEach(results, (value, key) => {
            const symbol = symbolGroup[key];
            newRatesObj[symbol] = value;
          });
          resolve(newRatesObj);
        }
      });
    });
    
    try {
      let store = await getStore();
      const newRates = await buildRates();
      _.forEach(newRates, (value, key) => {
        store.rates[key] = value;
      });
      store.nextGroup = (store.nextGroup + 1) % 3;
      const newStore = await setStore(store);
      return cb(null, newStore);
    } catch (err) {
      console.log(`${taskName} ERROR:`);
      console.log(err);
      cb(null, err);
    }
  };
  
  const buildBalances = (wallet, rates) => {
    console.log(`${taskName} BUILDING_BALANCE`);
    let totals = {};
    wallet.forEach((walletObj) => {
      const { currency, amount } = walletObj;
      const amountNum = Number(amount);
      const currencyUsd = `${currency}usd`;
      
      if (totals[currency] === undefined) {
        console.log(`${taskName} ADDING_NEW_CURRENCY: ${currency} - ${amountNum}`);
        totals[currency] = {};
        totals[currency].holding = amountNum;
        if (currency !== 'usd') {
          totals[currency].rate = rates[currencyUsd];
          totals[currency].value = amountNum * rates[currencyUsd];
        }
        else {
          totals[currency].value = amountNum;
        }
      }
      else {
        console.log(`${taskName} ADDING_TO_EXISTING_CURRENCY: ${currency} - ${amountNum}`);
        const currentTotal = totals[currency].holding;
        const newTotal = currentTotal + amountNum;
        totals[currency].holding = newTotal;
        if (currency !== 'usd') {
          totals[currency].value = newTotal * rates[currencyUsd];
        }
        else {
          totals[currency].value = newTotal;
        }
      }
    });
    
    let res = {};
    res.assets = totals;
    res.timestamp = Date.now();
    res.totalValue = 0;
    _.each(totals, (currencyObj, key) => {
      if (_.isNumber(currencyObj.value) && !_.isNaN(currencyObj.value)) {
        console.log(`${taskName} ADDING_TO_TOTAL: ${key} - $${currencyObj.value}`);
        res.totalValue += currencyObj.value;
      }
    });
    return res;
  };
  
  const getWallet = () => new Promise((resolve, reject) => {
    bfxRest.wallet_balances((err, res) => {
      if (err) {
        console.log(`${taskName} GET_WALLET_ERROR:`);
        reject(err);
      }
      resolve(res)
    });
  });
  
  async function getBalances() {
    let wallet, store;
    try {
      wallet = await getWallet();
      store = await getStore();
    } catch(err) {
      console.log(`${taskName} ERROR:`);
      cb(null, err);
    }
    const balances = buildBalances(wallet, store.rates);
    cb(null, balances)
  }
  
  if (ctx.query.summary === 'true') {
    console.log(`NEW_GET_BALANCES_REQUEST`);
    taskName = 'GET_BALANCES';
    getBalances();
  } else {
    console.log(`NEW_GET_RATES_REQUEST`);
    taskName = 'GET_RATES';
    try {
      const store = await getStore();
      const nextGroup = store.nextGroup || 0;
      getRates(nextGroup);
    } catch (err) {
      console.log(`${taskName} ERROR:`);
      console.log(err);
      cb(null, err);
    }
  }
};
