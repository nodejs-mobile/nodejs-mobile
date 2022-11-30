'use strict';

const {
  Array,
  Symbol,
} = primordials;

const kCompare = Symbol('compare');
const kHeap = Symbol('heap');
const kSetPosition = Symbol('setPosition');
const kSize = Symbol('size');

// The PriorityQueue is a basic implementation of a binary heap that accepts
// a custom sorting function via its constructor. This function is passed
// the two nodes to compare, similar to the native Array#sort. Crucially
// this enables priority queues that are based on a comparison of more than
// just a single criteria.

module.exports = class PriorityQueue {
  constructor(comparator, setPosition) {
    if (comparator !== undefined)
      this[kCompare] = comparator;
    if (setPosition !== undefined)
      this[kSetPosition] = setPosition;

    this[kHeap] = new Array(64);
    this[kSize] = 0;
  }

  [kCompare](a, b) {
    return a - b;
  }

  insert(value) {
    const heap = this[kHeap];
    const pos = ++this[kSize];
    heap[pos] = value;

    if (heap.length === pos)
      heap.length *= 2;

    this.percolateUp(pos);
  }

  peek() {
    return this[kHeap][1];
  }

  percolateDown(pos) {
    const compare = this[kCompare];
    const setPosition = this[kSetPosition];
    const heap = this[kHeap];
    const size = this[kSize];
    const item = heap[pos];

    while (pos * 2 <= size) {
      let childIndex = pos * 2 + 1;
      if (childIndex > size || compare(heap[pos * 2], heap[childIndex]) < 0)
        childIndex = pos * 2;
      const child = heap[childIndex];
      if (compare(item, child) <= 0)
        break;
      if (setPosition !== undefined)
        setPosition(child, pos);
      heap[pos] = child;
      pos = childIndex;
    }
    heap[pos] = item;
    if (setPosition !== undefined)
      setPosition(item, pos);
  }

  percolateUp(pos) {
    const heap = this[kHeap];
    const compare = this[kCompare];
    const setPosition = this[kSetPosition];
    const item = heap[pos];

    while (pos > 1) {
      const parent = heap[pos / 2 | 0];
      if (compare(parent, item) <= 0)
        break;
      heap[pos] = parent;
      if (setPosition !== undefined)
        setPosition(parent, pos);
      pos = pos / 2 | 0;
    }
    heap[pos] = item;
    if (setPosition !== undefined)
      setPosition(item, pos);
  }

  removeAt(pos) {
    const heap = this[kHeap];
    const size = --this[kSize];
    heap[pos] = heap[size + 1];
    heap[size + 1] = undefined;

    if (size > 0 && pos <= size) {
      if (pos > 1 && this[kCompare](heap[pos / 2 | 0], heap[pos]) > 0)
        this.percolateUp(pos);
      else
        this.percolateDown(pos);
    }
  }

  shift() {
    const heap = this[kHeap];
    const value = heap[1];
    if (value === undefined)
      return;

    this.removeAt(1);

    return value;
  }
};
