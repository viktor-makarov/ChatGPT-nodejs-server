const ErrorHandler = require("../errorHandler");


class AsyncQueue {
  constructor({ delayMs = 0, ttl = 60 * 60 * 1000, name, replyInstance } = {}) {
    if (ttl === undefined || ttl === null) {
      throw new Error('TTL parameter is required');
    }
    if (typeof ttl !== 'number' || ttl <= 0) {
      throw new Error('TTL must be a positive number');
    }
    
    this._delayMs = delayMs;
    this._ttl = ttl;
    this._tasks   = [];
    this._running = false;
    this._closed  = false;
    this._onEmptyResolver = null;
    this._ttlTimer = null;
    this._name = name || 'default';
    this._replyInstance = replyInstance;
    
    // Запускаем таймер TTL
    this._startTTLTimer();
  }

  add(task) {
    if (this._closed) throw new Error('Queue is closed');
    return new Promise((resolve, reject) => {
    this._tasks.push(async () => {
      try   { resolve(await task()); }
      catch (err){
        err.place_in_code = `AsyncQueue.${this._name}`;
        err.details = {
            task: task.toString(),
            tasksInQueue: this._tasks.length,
            originalStack: err.stack
        };
        ErrorHandler.main({
            replyMsgInstance: this._replyInstance,
            error_object: err
            });
        //reject(err); 
      }
    });
      this._start();          // запускаем обработчик, если он остановлен
    });
  }

  async close() {
    this._closed = true;
    
    // Очищаем таймер TTL если он еще активен
    if (this._ttlTimer) {
      clearTimeout(this._ttlTimer);
      this._ttlTimer = null;
    }
    
    if (this._running || this._tasks.length)
      await new Promise(res => (this._onEmptyResolver = res));
  }

  /* ---------- private ---------- */
  _startTTLTimer() {
    this._ttlTimer = setTimeout(() => {
      this.close().catch(err => {
        console.error('Error during TTL auto-close:', err);
      });
    }, this._ttl);
  }

  async _start() {
    if (this._running) return;
    this._running = true;
    while (this._tasks.length) {
      await this._tasks.shift()();
      if (this._delayMs) await new Promise(r => setTimeout(r, this._delayMs));
    }
    this._running = false;
    if (this._closed && this._onEmptyResolver) this._onEmptyResolver();
  }
};

module.exports = AsyncQueue;
