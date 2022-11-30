'use strict';

const {
  isMainThread,
  SHARE_ENV,
  resourceLimits,
  setEnvironmentData,
  getEnvironmentData,
  threadId,
  Worker
} = require('internal/worker');

const {
  MessagePort,
  MessageChannel,
  moveMessagePortToContext,
  receiveMessageOnPort,
  BroadcastChannel,
} = require('internal/worker/io');

const {
  markAsUntransferable,
} = require('internal/buffer');

module.exports = {
  isMainThread,
  MessagePort,
  MessageChannel,
  markAsUntransferable,
  moveMessagePortToContext,
  receiveMessageOnPort,
  resourceLimits,
  threadId,
  SHARE_ENV,
  Worker,
  parentPort: null,
  workerData: null,
  BroadcastChannel,
  setEnvironmentData,
  getEnvironmentData,
};
