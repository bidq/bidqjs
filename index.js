const net = require("net");
const uuid = require("uuid");
const EventEmitter = require("events");

const GENERAL_CHANNEL = "$/" + uuid();

class BidQ extends EventEmitter {
  constructor(clientOptions) {
    super();
    this._jobs = {};
    this._bids = {};
    this._clientPromise = new Promise(resolve => {
      const client = net.createConnection(clientOptions, () => resolve(client));
      client.on("data", raw => this.emit(GENERAL_CHANNEL, JSON.parse(raw)));
    });
    this.on(GENERAL_CHANNEL, msg => this._handle(msg));
  }

  _withJob(jobId, cb) {
    if (this._jobs[jobId]) {
      cb(this._jobs[jobId]);
    }
  }

  async _handle(message) {
    switch (message.type) {
      case "JOB_SUCCESS": {
        const { id, value } = message;
        return this._withJob(id, job => {
          job.done = "SUCCESS";
          job.resolve(value);
        });
      }
      case "JOB_FAILURE": {
        const { id, reason } = message;
        return this._withJob(id, job => {
          job.done = "FAILURE";
          job.reject(new Error(reason));
        });
      }
      case "SUBMIT": {
        const { id, topic, payload } = message;
        const event = topic || "$";
        if (this.eventNames().includes(event)) {
          this._bids[id] = { topic, payload };
          await this._send({ type: "BID", id });
        }
        break;
      }
      case "BID_ACK":
      case "BID_REJECT": {
        const { id } = message;
        const { topic, payload } = this._bids[id];
        delete this._bids[id];
        if (message.type === "BID_REJECT") {
          return;
        }
        const [resolve, reject] = this._getJobCallbacks(id);
        return this.emit(topic || "$", payload, resolve, reject);
      }
    }
  }

  _getJobCallbacks(id) {
    const resolve = value => this._send({ id, type: "JOB_SUCCESS", value });
    const reject = reason =>
      this._send({
        id,
        type: "JOB_FAILURE",
        reason: reason instanceof Error ? reason.message : reason.toString()
      });
    return [resolve, reject];
  }

  async _send(message) {
    const client = await this._clientPromise;
    client.write(JSON.stringify(message));
  }

  async submit(topic, payload, timeout = 0) {
    if (payload === undefined) {
      payload = topic;
      topic = null;
    }
    const id = uuid();
    await this._send({ type: "SUBMIT", id, topic, payload });
    return new Promise(resolve => {
      const handler = message => {
        if (message.type === "SUBMIT_ACK" && message.clientId === id) {
          this._jobs[message.id] = {
            topic,
            payload
          };
          this._jobs[message.id].promise = new Promise((resolve, reject) =>
            Object.assign(this._jobs[message.id], { resolve, reject })
          );
          if (timeout) {
            setTimeout(() => {
              if (this._jobs[message.id] && !this._jobs[message.id].done) {
                this.cancel(message.id);
              }
            }, timeout);
          }
          resolve(message.id);
        } else {
          this.once(GENERAL_CHANNEL, handler);
        }
      };
      this.once(GENERAL_CHANNEL, handler);
    });
  }

  get(jobId) {
    if (this._jobs[jobId]) {
      return this._jobs[jobId].promise;
    }
    return Promise.reject(new Error(`Job not found: ${jobId}`));
  }

  async cancel(jobId) {
    if (!this._jobs[jobId]) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (this._jobs[jobId].done) {
      throw new Error(`Job already done: ${jobId}`);
    }
    await this._send({ type: "CANCEL", id: jobId });
    this.emit(GENERAL_CHANNEL, {
      type: "JOB_FAILURE",
      id: jobId,
      reason: "Client Timeout"
    });
  }

  async clear(jobId) {
    try {
      await this.cancel(jobId);
    } finally {
      delete this._jobs[jobId];
    }
  }

  async close() {
    (await this._clientPromise).end();
  }

  getAllJobs() {
    return Object.keys(this._jobs).reduce(
      (jobs, jobId) => ({
        ...jobs,
        [jobId]: {
          status: this._jobs[jobId].done || "PENDING",
          topic: this._jobs[jobId].topic,
          payload: this._jobs[jobId].payload
        }
      }),
      {}
    );
  }
}

module.exports = BidQ;
