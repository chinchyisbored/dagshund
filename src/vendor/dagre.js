var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// node_modules/@dagrejs/graphlib/lib/graph.js
var require_graph = __commonJS((exports, module) => {
  var DEFAULT_EDGE_NAME = "\x00";
  var GRAPH_NODE = "\x00";
  var EDGE_KEY_DELIM = "\x01";

  class Graph {
    _isDirected = true;
    _isMultigraph = false;
    _isCompound = false;
    _label;
    _defaultNodeLabelFn = () => {
      return;
    };
    _defaultEdgeLabelFn = () => {
      return;
    };
    _nodes = {};
    _in = {};
    _preds = {};
    _out = {};
    _sucs = {};
    _edgeObjs = {};
    _edgeLabels = {};
    _nodeCount = 0;
    _edgeCount = 0;
    _parent;
    _children;
    constructor(opts) {
      if (opts) {
        this._isDirected = Object.hasOwn(opts, "directed") ? opts.directed : true;
        this._isMultigraph = Object.hasOwn(opts, "multigraph") ? opts.multigraph : false;
        this._isCompound = Object.hasOwn(opts, "compound") ? opts.compound : false;
      }
      if (this._isCompound) {
        this._parent = {};
        this._children = {};
        this._children[GRAPH_NODE] = {};
      }
    }
    isDirected() {
      return this._isDirected;
    }
    isMultigraph() {
      return this._isMultigraph;
    }
    isCompound() {
      return this._isCompound;
    }
    setGraph(label) {
      this._label = label;
      return this;
    }
    graph() {
      return this._label;
    }
    setDefaultNodeLabel(newDefault) {
      this._defaultNodeLabelFn = newDefault;
      if (typeof newDefault !== "function") {
        this._defaultNodeLabelFn = () => newDefault;
      }
      return this;
    }
    nodeCount() {
      return this._nodeCount;
    }
    nodes() {
      return Object.keys(this._nodes);
    }
    sources() {
      var self = this;
      return this.nodes().filter((v) => Object.keys(self._in[v]).length === 0);
    }
    sinks() {
      var self = this;
      return this.nodes().filter((v) => Object.keys(self._out[v]).length === 0);
    }
    setNodes(vs, value) {
      var args = arguments;
      var self = this;
      vs.forEach(function(v) {
        if (args.length > 1) {
          self.setNode(v, value);
        } else {
          self.setNode(v);
        }
      });
      return this;
    }
    setNode(v, value) {
      if (Object.hasOwn(this._nodes, v)) {
        if (arguments.length > 1) {
          this._nodes[v] = value;
        }
        return this;
      }
      this._nodes[v] = arguments.length > 1 ? value : this._defaultNodeLabelFn(v);
      if (this._isCompound) {
        this._parent[v] = GRAPH_NODE;
        this._children[v] = {};
        this._children[GRAPH_NODE][v] = true;
      }
      this._in[v] = {};
      this._preds[v] = {};
      this._out[v] = {};
      this._sucs[v] = {};
      ++this._nodeCount;
      return this;
    }
    node(v) {
      return this._nodes[v];
    }
    hasNode(v) {
      return Object.hasOwn(this._nodes, v);
    }
    removeNode(v) {
      var self = this;
      if (Object.hasOwn(this._nodes, v)) {
        var removeEdge = (e) => self.removeEdge(self._edgeObjs[e]);
        delete this._nodes[v];
        if (this._isCompound) {
          this._removeFromParentsChildList(v);
          delete this._parent[v];
          this.children(v).forEach(function(child) {
            self.setParent(child);
          });
          delete this._children[v];
        }
        Object.keys(this._in[v]).forEach(removeEdge);
        delete this._in[v];
        delete this._preds[v];
        Object.keys(this._out[v]).forEach(removeEdge);
        delete this._out[v];
        delete this._sucs[v];
        --this._nodeCount;
      }
      return this;
    }
    setParent(v, parent) {
      if (!this._isCompound) {
        throw new Error("Cannot set parent in a non-compound graph");
      }
      if (parent === undefined) {
        parent = GRAPH_NODE;
      } else {
        parent += "";
        for (var ancestor = parent;ancestor !== undefined; ancestor = this.parent(ancestor)) {
          if (ancestor === v) {
            throw new Error("Setting " + parent + " as parent of " + v + " would create a cycle");
          }
        }
        this.setNode(parent);
      }
      this.setNode(v);
      this._removeFromParentsChildList(v);
      this._parent[v] = parent;
      this._children[parent][v] = true;
      return this;
    }
    _removeFromParentsChildList(v) {
      delete this._children[this._parent[v]][v];
    }
    parent(v) {
      if (this._isCompound) {
        var parent = this._parent[v];
        if (parent !== GRAPH_NODE) {
          return parent;
        }
      }
    }
    children(v = GRAPH_NODE) {
      if (this._isCompound) {
        var children = this._children[v];
        if (children) {
          return Object.keys(children);
        }
      } else if (v === GRAPH_NODE) {
        return this.nodes();
      } else if (this.hasNode(v)) {
        return [];
      }
    }
    predecessors(v) {
      var predsV = this._preds[v];
      if (predsV) {
        return Object.keys(predsV);
      }
    }
    successors(v) {
      var sucsV = this._sucs[v];
      if (sucsV) {
        return Object.keys(sucsV);
      }
    }
    neighbors(v) {
      var preds = this.predecessors(v);
      if (preds) {
        const union = new Set(preds);
        for (var succ of this.successors(v)) {
          union.add(succ);
        }
        return Array.from(union.values());
      }
    }
    isLeaf(v) {
      var neighbors;
      if (this.isDirected()) {
        neighbors = this.successors(v);
      } else {
        neighbors = this.neighbors(v);
      }
      return neighbors.length === 0;
    }
    filterNodes(filter) {
      var copy = new this.constructor({
        directed: this._isDirected,
        multigraph: this._isMultigraph,
        compound: this._isCompound
      });
      copy.setGraph(this.graph());
      var self = this;
      Object.entries(this._nodes).forEach(function([v, value]) {
        if (filter(v)) {
          copy.setNode(v, value);
        }
      });
      Object.values(this._edgeObjs).forEach(function(e) {
        if (copy.hasNode(e.v) && copy.hasNode(e.w)) {
          copy.setEdge(e, self.edge(e));
        }
      });
      var parents = {};
      function findParent(v) {
        var parent = self.parent(v);
        if (parent === undefined || copy.hasNode(parent)) {
          parents[v] = parent;
          return parent;
        } else if (parent in parents) {
          return parents[parent];
        } else {
          return findParent(parent);
        }
      }
      if (this._isCompound) {
        copy.nodes().forEach((v) => copy.setParent(v, findParent(v)));
      }
      return copy;
    }
    setDefaultEdgeLabel(newDefault) {
      this._defaultEdgeLabelFn = newDefault;
      if (typeof newDefault !== "function") {
        this._defaultEdgeLabelFn = () => newDefault;
      }
      return this;
    }
    edgeCount() {
      return this._edgeCount;
    }
    edges() {
      return Object.values(this._edgeObjs);
    }
    setPath(vs, value) {
      var self = this;
      var args = arguments;
      vs.reduce(function(v, w) {
        if (args.length > 1) {
          self.setEdge(v, w, value);
        } else {
          self.setEdge(v, w);
        }
        return w;
      });
      return this;
    }
    setEdge() {
      var v, w, name, value;
      var valueSpecified = false;
      var arg0 = arguments[0];
      if (typeof arg0 === "object" && arg0 !== null && "v" in arg0) {
        v = arg0.v;
        w = arg0.w;
        name = arg0.name;
        if (arguments.length === 2) {
          value = arguments[1];
          valueSpecified = true;
        }
      } else {
        v = arg0;
        w = arguments[1];
        name = arguments[3];
        if (arguments.length > 2) {
          value = arguments[2];
          valueSpecified = true;
        }
      }
      v = "" + v;
      w = "" + w;
      if (name !== undefined) {
        name = "" + name;
      }
      var e = edgeArgsToId(this._isDirected, v, w, name);
      if (Object.hasOwn(this._edgeLabels, e)) {
        if (valueSpecified) {
          this._edgeLabels[e] = value;
        }
        return this;
      }
      if (name !== undefined && !this._isMultigraph) {
        throw new Error("Cannot set a named edge when isMultigraph = false");
      }
      this.setNode(v);
      this.setNode(w);
      this._edgeLabels[e] = valueSpecified ? value : this._defaultEdgeLabelFn(v, w, name);
      var edgeObj = edgeArgsToObj(this._isDirected, v, w, name);
      v = edgeObj.v;
      w = edgeObj.w;
      Object.freeze(edgeObj);
      this._edgeObjs[e] = edgeObj;
      incrementOrInitEntry(this._preds[w], v);
      incrementOrInitEntry(this._sucs[v], w);
      this._in[w][e] = edgeObj;
      this._out[v][e] = edgeObj;
      this._edgeCount++;
      return this;
    }
    edge(v, w, name) {
      var e = arguments.length === 1 ? edgeObjToId(this._isDirected, arguments[0]) : edgeArgsToId(this._isDirected, v, w, name);
      return this._edgeLabels[e];
    }
    edgeAsObj() {
      const edge = this.edge(...arguments);
      if (typeof edge !== "object") {
        return { label: edge };
      }
      return edge;
    }
    hasEdge(v, w, name) {
      var e = arguments.length === 1 ? edgeObjToId(this._isDirected, arguments[0]) : edgeArgsToId(this._isDirected, v, w, name);
      return Object.hasOwn(this._edgeLabels, e);
    }
    removeEdge(v, w, name) {
      var e = arguments.length === 1 ? edgeObjToId(this._isDirected, arguments[0]) : edgeArgsToId(this._isDirected, v, w, name);
      var edge = this._edgeObjs[e];
      if (edge) {
        v = edge.v;
        w = edge.w;
        delete this._edgeLabels[e];
        delete this._edgeObjs[e];
        decrementOrRemoveEntry(this._preds[w], v);
        decrementOrRemoveEntry(this._sucs[v], w);
        delete this._in[w][e];
        delete this._out[v][e];
        this._edgeCount--;
      }
      return this;
    }
    inEdges(v, u) {
      var inV = this._in[v];
      if (inV) {
        var edges = Object.values(inV);
        if (!u) {
          return edges;
        }
        return edges.filter((edge) => edge.v === u);
      }
    }
    outEdges(v, w) {
      var outV = this._out[v];
      if (outV) {
        var edges = Object.values(outV);
        if (!w) {
          return edges;
        }
        return edges.filter((edge) => edge.w === w);
      }
    }
    nodeEdges(v, w) {
      var inEdges = this.inEdges(v, w);
      if (inEdges) {
        return inEdges.concat(this.outEdges(v, w));
      }
    }
  }
  function incrementOrInitEntry(map, k) {
    if (map[k]) {
      map[k]++;
    } else {
      map[k] = 1;
    }
  }
  function decrementOrRemoveEntry(map, k) {
    if (!--map[k]) {
      delete map[k];
    }
  }
  function edgeArgsToId(isDirected, v_, w_, name) {
    var v = "" + v_;
    var w = "" + w_;
    if (!isDirected && v > w) {
      var tmp = v;
      v = w;
      w = tmp;
    }
    return v + EDGE_KEY_DELIM + w + EDGE_KEY_DELIM + (name === undefined ? DEFAULT_EDGE_NAME : name);
  }
  function edgeArgsToObj(isDirected, v_, w_, name) {
    var v = "" + v_;
    var w = "" + w_;
    if (!isDirected && v > w) {
      var tmp = v;
      v = w;
      w = tmp;
    }
    var edgeObj = { v, w };
    if (name) {
      edgeObj.name = name;
    }
    return edgeObj;
  }
  function edgeObjToId(isDirected, edgeObj) {
    return edgeArgsToId(isDirected, edgeObj.v, edgeObj.w, edgeObj.name);
  }
  module.exports = Graph;
});

// node_modules/@dagrejs/graphlib/lib/version.js
var require_version = __commonJS((exports, module) => {
  module.exports = "2.2.4";
});

// node_modules/@dagrejs/graphlib/lib/index.js
var require_lib = __commonJS((exports, module) => {
  module.exports = {
    Graph: require_graph(),
    version: require_version()
  };
});

// node_modules/@dagrejs/graphlib/lib/json.js
var require_json = __commonJS((exports, module) => {
  var Graph = require_graph();
  module.exports = {
    write,
    read
  };
  function write(g) {
    var json = {
      options: {
        directed: g.isDirected(),
        multigraph: g.isMultigraph(),
        compound: g.isCompound()
      },
      nodes: writeNodes(g),
      edges: writeEdges(g)
    };
    if (g.graph() !== undefined) {
      json.value = structuredClone(g.graph());
    }
    return json;
  }
  function writeNodes(g) {
    return g.nodes().map(function(v) {
      var nodeValue = g.node(v);
      var parent = g.parent(v);
      var node = { v };
      if (nodeValue !== undefined) {
        node.value = nodeValue;
      }
      if (parent !== undefined) {
        node.parent = parent;
      }
      return node;
    });
  }
  function writeEdges(g) {
    return g.edges().map(function(e) {
      var edgeValue = g.edge(e);
      var edge = { v: e.v, w: e.w };
      if (e.name !== undefined) {
        edge.name = e.name;
      }
      if (edgeValue !== undefined) {
        edge.value = edgeValue;
      }
      return edge;
    });
  }
  function read(json) {
    var g = new Graph(json.options).setGraph(json.value);
    json.nodes.forEach(function(entry) {
      g.setNode(entry.v, entry.value);
      if (entry.parent) {
        g.setParent(entry.v, entry.parent);
      }
    });
    json.edges.forEach(function(entry) {
      g.setEdge({ v: entry.v, w: entry.w, name: entry.name }, entry.value);
    });
    return g;
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/components.js
var require_components = __commonJS((exports, module) => {
  module.exports = components;
  function components(g) {
    var visited = {};
    var cmpts = [];
    var cmpt;
    function dfs(v) {
      if (Object.hasOwn(visited, v))
        return;
      visited[v] = true;
      cmpt.push(v);
      g.successors(v).forEach(dfs);
      g.predecessors(v).forEach(dfs);
    }
    g.nodes().forEach(function(v) {
      cmpt = [];
      dfs(v);
      if (cmpt.length) {
        cmpts.push(cmpt);
      }
    });
    return cmpts;
  }
});

// node_modules/@dagrejs/graphlib/lib/data/priority-queue.js
var require_priority_queue = __commonJS((exports, module) => {
  class PriorityQueue {
    _arr = [];
    _keyIndices = {};
    size() {
      return this._arr.length;
    }
    keys() {
      return this._arr.map(function(x) {
        return x.key;
      });
    }
    has(key) {
      return Object.hasOwn(this._keyIndices, key);
    }
    priority(key) {
      var index = this._keyIndices[key];
      if (index !== undefined) {
        return this._arr[index].priority;
      }
    }
    min() {
      if (this.size() === 0) {
        throw new Error("Queue underflow");
      }
      return this._arr[0].key;
    }
    add(key, priority) {
      var keyIndices = this._keyIndices;
      key = String(key);
      if (!Object.hasOwn(keyIndices, key)) {
        var arr = this._arr;
        var index = arr.length;
        keyIndices[key] = index;
        arr.push({ key, priority });
        this._decrease(index);
        return true;
      }
      return false;
    }
    removeMin() {
      this._swap(0, this._arr.length - 1);
      var min = this._arr.pop();
      delete this._keyIndices[min.key];
      this._heapify(0);
      return min.key;
    }
    decrease(key, priority) {
      var index = this._keyIndices[key];
      if (priority > this._arr[index].priority) {
        throw new Error("New priority is greater than current priority. " + "Key: " + key + " Old: " + this._arr[index].priority + " New: " + priority);
      }
      this._arr[index].priority = priority;
      this._decrease(index);
    }
    _heapify(i) {
      var arr = this._arr;
      var l = 2 * i;
      var r = l + 1;
      var largest = i;
      if (l < arr.length) {
        largest = arr[l].priority < arr[largest].priority ? l : largest;
        if (r < arr.length) {
          largest = arr[r].priority < arr[largest].priority ? r : largest;
        }
        if (largest !== i) {
          this._swap(i, largest);
          this._heapify(largest);
        }
      }
    }
    _decrease(index) {
      var arr = this._arr;
      var priority = arr[index].priority;
      var parent;
      while (index !== 0) {
        parent = index >> 1;
        if (arr[parent].priority < priority) {
          break;
        }
        this._swap(index, parent);
        index = parent;
      }
    }
    _swap(i, j) {
      var arr = this._arr;
      var keyIndices = this._keyIndices;
      var origArrI = arr[i];
      var origArrJ = arr[j];
      arr[i] = origArrJ;
      arr[j] = origArrI;
      keyIndices[origArrJ.key] = i;
      keyIndices[origArrI.key] = j;
    }
  }
  module.exports = PriorityQueue;
});

// node_modules/@dagrejs/graphlib/lib/alg/dijkstra.js
var require_dijkstra = __commonJS((exports, module) => {
  var PriorityQueue = require_priority_queue();
  module.exports = dijkstra;
  var DEFAULT_WEIGHT_FUNC = () => 1;
  function dijkstra(g, source, weightFn, edgeFn) {
    return runDijkstra(g, String(source), weightFn || DEFAULT_WEIGHT_FUNC, edgeFn || function(v) {
      return g.outEdges(v);
    });
  }
  function runDijkstra(g, source, weightFn, edgeFn) {
    var results = {};
    var pq = new PriorityQueue;
    var v, vEntry;
    var updateNeighbors = function(edge) {
      var w = edge.v !== v ? edge.v : edge.w;
      var wEntry = results[w];
      var weight = weightFn(edge);
      var distance = vEntry.distance + weight;
      if (weight < 0) {
        throw new Error("dijkstra does not allow negative edge weights. " + "Bad edge: " + edge + " Weight: " + weight);
      }
      if (distance < wEntry.distance) {
        wEntry.distance = distance;
        wEntry.predecessor = v;
        pq.decrease(w, distance);
      }
    };
    g.nodes().forEach(function(v2) {
      var distance = v2 === source ? 0 : Number.POSITIVE_INFINITY;
      results[v2] = { distance };
      pq.add(v2, distance);
    });
    while (pq.size() > 0) {
      v = pq.removeMin();
      vEntry = results[v];
      if (vEntry.distance === Number.POSITIVE_INFINITY) {
        break;
      }
      edgeFn(v).forEach(updateNeighbors);
    }
    return results;
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/dijkstra-all.js
var require_dijkstra_all = __commonJS((exports, module) => {
  var dijkstra = require_dijkstra();
  module.exports = dijkstraAll;
  function dijkstraAll(g, weightFunc, edgeFunc) {
    return g.nodes().reduce(function(acc, v) {
      acc[v] = dijkstra(g, v, weightFunc, edgeFunc);
      return acc;
    }, {});
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/tarjan.js
var require_tarjan = __commonJS((exports, module) => {
  module.exports = tarjan;
  function tarjan(g) {
    var index = 0;
    var stack = [];
    var visited = {};
    var results = [];
    function dfs(v) {
      var entry = visited[v] = {
        onStack: true,
        lowlink: index,
        index: index++
      };
      stack.push(v);
      g.successors(v).forEach(function(w2) {
        if (!Object.hasOwn(visited, w2)) {
          dfs(w2);
          entry.lowlink = Math.min(entry.lowlink, visited[w2].lowlink);
        } else if (visited[w2].onStack) {
          entry.lowlink = Math.min(entry.lowlink, visited[w2].index);
        }
      });
      if (entry.lowlink === entry.index) {
        var cmpt = [];
        var w;
        do {
          w = stack.pop();
          visited[w].onStack = false;
          cmpt.push(w);
        } while (v !== w);
        results.push(cmpt);
      }
    }
    g.nodes().forEach(function(v) {
      if (!Object.hasOwn(visited, v)) {
        dfs(v);
      }
    });
    return results;
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/find-cycles.js
var require_find_cycles = __commonJS((exports, module) => {
  var tarjan = require_tarjan();
  module.exports = findCycles;
  function findCycles(g) {
    return tarjan(g).filter(function(cmpt) {
      return cmpt.length > 1 || cmpt.length === 1 && g.hasEdge(cmpt[0], cmpt[0]);
    });
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/floyd-warshall.js
var require_floyd_warshall = __commonJS((exports, module) => {
  module.exports = floydWarshall;
  var DEFAULT_WEIGHT_FUNC = () => 1;
  function floydWarshall(g, weightFn, edgeFn) {
    return runFloydWarshall(g, weightFn || DEFAULT_WEIGHT_FUNC, edgeFn || function(v) {
      return g.outEdges(v);
    });
  }
  function runFloydWarshall(g, weightFn, edgeFn) {
    var results = {};
    var nodes = g.nodes();
    nodes.forEach(function(v) {
      results[v] = {};
      results[v][v] = { distance: 0 };
      nodes.forEach(function(w) {
        if (v !== w) {
          results[v][w] = { distance: Number.POSITIVE_INFINITY };
        }
      });
      edgeFn(v).forEach(function(edge) {
        var w = edge.v === v ? edge.w : edge.v;
        var d = weightFn(edge);
        results[v][w] = { distance: d, predecessor: v };
      });
    });
    nodes.forEach(function(k) {
      var rowK = results[k];
      nodes.forEach(function(i) {
        var rowI = results[i];
        nodes.forEach(function(j) {
          var ik = rowI[k];
          var kj = rowK[j];
          var ij = rowI[j];
          var altDistance = ik.distance + kj.distance;
          if (altDistance < ij.distance) {
            ij.distance = altDistance;
            ij.predecessor = kj.predecessor;
          }
        });
      });
    });
    return results;
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/topsort.js
var require_topsort = __commonJS((exports, module) => {
  function topsort(g) {
    var visited = {};
    var stack = {};
    var results = [];
    function visit(node) {
      if (Object.hasOwn(stack, node)) {
        throw new CycleException;
      }
      if (!Object.hasOwn(visited, node)) {
        stack[node] = true;
        visited[node] = true;
        g.predecessors(node).forEach(visit);
        delete stack[node];
        results.push(node);
      }
    }
    g.sinks().forEach(visit);
    if (Object.keys(visited).length !== g.nodeCount()) {
      throw new CycleException;
    }
    return results;
  }

  class CycleException extends Error {
    constructor() {
      super(...arguments);
    }
  }
  module.exports = topsort;
  topsort.CycleException = CycleException;
});

// node_modules/@dagrejs/graphlib/lib/alg/is-acyclic.js
var require_is_acyclic = __commonJS((exports, module) => {
  var topsort = require_topsort();
  module.exports = isAcyclic;
  function isAcyclic(g) {
    try {
      topsort(g);
    } catch (e) {
      if (e instanceof topsort.CycleException) {
        return false;
      }
      throw e;
    }
    return true;
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/dfs.js
var require_dfs = __commonJS((exports, module) => {
  module.exports = dfs;
  function dfs(g, vs, order) {
    if (!Array.isArray(vs)) {
      vs = [vs];
    }
    var navigation = g.isDirected() ? (v) => g.successors(v) : (v) => g.neighbors(v);
    var orderFunc = order === "post" ? postOrderDfs : preOrderDfs;
    var acc = [];
    var visited = {};
    vs.forEach((v) => {
      if (!g.hasNode(v)) {
        throw new Error("Graph does not have node: " + v);
      }
      orderFunc(v, navigation, visited, acc);
    });
    return acc;
  }
  function postOrderDfs(v, navigation, visited, acc) {
    var stack = [[v, false]];
    while (stack.length > 0) {
      var curr = stack.pop();
      if (curr[1]) {
        acc.push(curr[0]);
      } else {
        if (!Object.hasOwn(visited, curr[0])) {
          visited[curr[0]] = true;
          stack.push([curr[0], true]);
          forEachRight(navigation(curr[0]), (w) => stack.push([w, false]));
        }
      }
    }
  }
  function preOrderDfs(v, navigation, visited, acc) {
    var stack = [v];
    while (stack.length > 0) {
      var curr = stack.pop();
      if (!Object.hasOwn(visited, curr)) {
        visited[curr] = true;
        acc.push(curr);
        forEachRight(navigation(curr), (w) => stack.push(w));
      }
    }
  }
  function forEachRight(array, iteratee) {
    var length = array.length;
    while (length--) {
      iteratee(array[length], length, array);
    }
    return array;
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/postorder.js
var require_postorder = __commonJS((exports, module) => {
  var dfs = require_dfs();
  module.exports = postorder;
  function postorder(g, vs) {
    return dfs(g, vs, "post");
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/preorder.js
var require_preorder = __commonJS((exports, module) => {
  var dfs = require_dfs();
  module.exports = preorder;
  function preorder(g, vs) {
    return dfs(g, vs, "pre");
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/prim.js
var require_prim = __commonJS((exports, module) => {
  var Graph = require_graph();
  var PriorityQueue = require_priority_queue();
  module.exports = prim;
  function prim(g, weightFunc) {
    var result = new Graph;
    var parents = {};
    var pq = new PriorityQueue;
    var v;
    function updateNeighbors(edge) {
      var w = edge.v === v ? edge.w : edge.v;
      var pri = pq.priority(w);
      if (pri !== undefined) {
        var edgeWeight = weightFunc(edge);
        if (edgeWeight < pri) {
          parents[w] = v;
          pq.decrease(w, edgeWeight);
        }
      }
    }
    if (g.nodeCount() === 0) {
      return result;
    }
    g.nodes().forEach(function(v2) {
      pq.add(v2, Number.POSITIVE_INFINITY);
      result.setNode(v2);
    });
    pq.decrease(g.nodes()[0], 0);
    var init = false;
    while (pq.size() > 0) {
      v = pq.removeMin();
      if (Object.hasOwn(parents, v)) {
        result.setEdge(v, parents[v]);
      } else if (init) {
        throw new Error("Input graph is not connected: " + g);
      } else {
        init = true;
      }
      g.nodeEdges(v).forEach(updateNeighbors);
    }
    return result;
  }
});

// node_modules/@dagrejs/graphlib/lib/alg/index.js
var require_alg = __commonJS((exports, module) => {
  module.exports = {
    components: require_components(),
    dijkstra: require_dijkstra(),
    dijkstraAll: require_dijkstra_all(),
    findCycles: require_find_cycles(),
    floydWarshall: require_floyd_warshall(),
    isAcyclic: require_is_acyclic(),
    postorder: require_postorder(),
    preorder: require_preorder(),
    prim: require_prim(),
    tarjan: require_tarjan(),
    topsort: require_topsort()
  };
});

// node_modules/@dagrejs/graphlib/index.js
var require_graphlib = __commonJS((exports, module) => {
  var lib = require_lib();
  module.exports = {
    Graph: lib.Graph,
    json: require_json(),
    alg: require_alg(),
    version: lib.version
  };
});

// node_modules/@dagrejs/dagre/dist/dagre.cjs.js
var require_dagre_cjs = __commonJS((exports, module) => {
  var p = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports);
  var Y = p((ni, D) => {
    var q = class {
      constructor() {
        let t = {};
        t._next = t._prev = t, this._sentinel = t;
      }
      dequeue() {
        let t = this._sentinel, r = t._prev;
        if (r !== t)
          return B(r), r;
      }
      enqueue(t) {
        let r = this._sentinel;
        t._prev && t._next && B(t), t._next = r._next, r._next._prev = t, r._next = t, t._prev = r;
      }
      toString() {
        let t = [], r = this._sentinel, n = r._prev;
        for (;n !== r; )
          t.push(JSON.stringify(n, vt)), n = n._prev;
        return "[" + t.join(", ") + "]";
      }
    };
    function B(e) {
      e._prev._next = e._next, e._next._prev = e._prev, delete e._next, delete e._prev;
    }
    function vt(e, t) {
      if (e !== "_next" && e !== "_prev")
        return t;
    }
    D.exports = q;
  });
  var W = p((ii, A) => {
    var Nt = require_graphlib().Graph, Ot = Y();
    A.exports = qt;
    var It = () => 1;
    function qt(e, t) {
      if (e.nodeCount() <= 1)
        return [];
      let r = Rt(e, t || It);
      return Lt(r.graph, r.buckets, r.zeroIdx).flatMap((i) => e.outEdges(i.v, i.w));
    }
    function Lt(e, t, r) {
      let n = [], i = t[t.length - 1], a = t[0], o;
      for (;e.nodeCount(); ) {
        for (;o = a.dequeue(); )
          L(e, t, r, o);
        for (;o = i.dequeue(); )
          L(e, t, r, o);
        if (e.nodeCount()) {
          for (let l = t.length - 2;l > 0; --l)
            if (o = t[l].dequeue(), o) {
              n = n.concat(L(e, t, r, o, true));
              break;
            }
        }
      }
      return n;
    }
    function L(e, t, r, n, i) {
      let a = i ? [] : undefined;
      return e.inEdges(n.v).forEach((o) => {
        let l = e.edge(o), s = e.node(o.v);
        i && a.push({ v: o.v, w: o.w }), s.out -= l, R(t, r, s);
      }), e.outEdges(n.v).forEach((o) => {
        let l = e.edge(o), s = o.w, d = e.node(s);
        d.in -= l, R(t, r, d);
      }), e.removeNode(n.v), a;
    }
    function Rt(e, t) {
      let r = new Nt, n = 0, i = 0;
      e.nodes().forEach((l) => {
        r.setNode(l, { v: l, in: 0, out: 0 });
      }), e.edges().forEach((l) => {
        let s = r.edge(l.v, l.w) || 0, d = t(l), u = s + d;
        r.setEdge(l.v, l.w, u), i = Math.max(i, r.node(l.v).out += d), n = Math.max(n, r.node(l.w).in += d);
      });
      let a = Ct(i + n + 3).map(() => new Ot), o = n + 1;
      return r.nodes().forEach((l) => {
        R(a, o, r.node(l));
      }), { graph: r, buckets: a, zeroIdx: o };
    }
    function R(e, t, r) {
      r.out ? r.in ? e[r.out - r.in + t].enqueue(r) : e[e.length - 1].enqueue(r) : e[0].enqueue(r);
    }
    function Ct(e) {
      let t = [];
      for (let r = 0;r < e; r++)
        t.push(r);
      return t;
    }
  });
  var m = p((oi, Q) => {
    var z = require_graphlib().Graph;
    Q.exports = { addBorderNode: Ft, addDummyNode: X, applyWithChunking: v, asNonCompoundGraph: Tt, buildLayerMatrix: Pt, intersectRect: St, mapValues: Xt, maxRank: U, normalizeRanks: Gt, notime: At, partition: Dt, pick: zt, predecessorWeights: _t, range: K, removeEmptyRanks: Vt, simplify: Mt, successorWeights: jt, time: Yt, uniqueId: J, zipObject: C };
    function X(e, t, r, n) {
      for (var i = n;e.hasNode(i); )
        i = J(n);
      return r.dummy = t, e.setNode(i, r), i;
    }
    function Mt(e) {
      let t = new z().setGraph(e.graph());
      return e.nodes().forEach((r) => t.setNode(r, e.node(r))), e.edges().forEach((r) => {
        let n = t.edge(r.v, r.w) || { weight: 0, minlen: 1 }, i = e.edge(r);
        t.setEdge(r.v, r.w, { weight: n.weight + i.weight, minlen: Math.max(n.minlen, i.minlen) });
      }), t;
    }
    function Tt(e) {
      let t = new z({ multigraph: e.isMultigraph() }).setGraph(e.graph());
      return e.nodes().forEach((r) => {
        e.children(r).length || t.setNode(r, e.node(r));
      }), e.edges().forEach((r) => {
        t.setEdge(r, e.edge(r));
      }), t;
    }
    function jt(e) {
      let t = e.nodes().map((r) => {
        let n = {};
        return e.outEdges(r).forEach((i) => {
          n[i.w] = (n[i.w] || 0) + e.edge(i).weight;
        }), n;
      });
      return C(e.nodes(), t);
    }
    function _t(e) {
      let t = e.nodes().map((r) => {
        let n = {};
        return e.inEdges(r).forEach((i) => {
          n[i.v] = (n[i.v] || 0) + e.edge(i).weight;
        }), n;
      });
      return C(e.nodes(), t);
    }
    function St(e, t) {
      let { x: r, y: n } = e, i = t.x - r, a = t.y - n, o = e.width / 2, l = e.height / 2;
      if (!i && !a)
        throw new Error("Not possible to find intersection inside of the rectangle");
      let s, d;
      return Math.abs(a) * o > Math.abs(i) * l ? (a < 0 && (l = -l), s = l * i / a, d = l) : (i < 0 && (o = -o), s = o, d = o * a / i), { x: r + s, y: n + d };
    }
    function Pt(e) {
      let t = K(U(e) + 1).map(() => []);
      return e.nodes().forEach((r) => {
        let n = e.node(r), i = n.rank;
        i !== undefined && (t[i][n.order] = r);
      }), t;
    }
    function Gt(e) {
      let t = e.nodes().map((n) => {
        let i = e.node(n).rank;
        return i === undefined ? Number.MAX_VALUE : i;
      }), r = v(Math.min, t);
      e.nodes().forEach((n) => {
        let i = e.node(n);
        Object.hasOwn(i, "rank") && (i.rank -= r);
      });
    }
    function Vt(e) {
      let t = e.nodes().map((o) => e.node(o).rank).filter((o) => o !== undefined), r = v(Math.min, t), n = [];
      e.nodes().forEach((o) => {
        let l = e.node(o).rank - r;
        n[l] || (n[l] = []), n[l].push(o);
      });
      let i = 0, a = e.graph().nodeRankFactor;
      Array.from(n).forEach((o, l) => {
        o === undefined && l % a !== 0 ? --i : o !== undefined && i && o.forEach((s) => e.node(s).rank += i);
      });
    }
    function Ft(e, t, r, n) {
      let i = { width: 0, height: 0 };
      return arguments.length >= 4 && (i.rank = r, i.order = n), X(e, "border", i, t);
    }
    function Bt(e, t = H) {
      let r = [];
      for (let n = 0;n < e.length; n += t) {
        let i = e.slice(n, n + t);
        r.push(i);
      }
      return r;
    }
    var H = 65535;
    function v(e, t) {
      if (t.length > H) {
        let r = Bt(t);
        return e.apply(null, r.map((n) => e.apply(null, n)));
      } else
        return e.apply(null, t);
    }
    function U(e) {
      let r = e.nodes().map((n) => {
        let i = e.node(n).rank;
        return i === undefined ? Number.MIN_VALUE : i;
      });
      return v(Math.max, r);
    }
    function Dt(e, t) {
      let r = { lhs: [], rhs: [] };
      return e.forEach((n) => {
        t(n) ? r.lhs.push(n) : r.rhs.push(n);
      }), r;
    }
    function Yt(e, t) {
      let r = Date.now();
      try {
        return t();
      } finally {
        console.log(e + " time: " + (Date.now() - r) + "ms");
      }
    }
    function At(e, t) {
      return t();
    }
    var Wt = 0;
    function J(e) {
      var t = ++Wt;
      return e + ("" + t);
    }
    function K(e, t, r = 1) {
      t == null && (t = e, e = 0);
      let n = (a) => a < t;
      r < 0 && (n = (a) => t < a);
      let i = [];
      for (let a = e;n(a); a += r)
        i.push(a);
      return i;
    }
    function zt(e, t) {
      let r = {};
      for (let n of t)
        e[n] !== undefined && (r[n] = e[n]);
      return r;
    }
    function Xt(e, t) {
      let r = t;
      return typeof t == "string" && (r = (n) => n[t]), Object.entries(e).reduce((n, [i, a]) => (n[i] = r(a, i), n), {});
    }
    function C(e, t) {
      return e.reduce((r, n, i) => (r[n] = t[i], r), {});
    }
  });
  var $ = p((ai, Z) => {
    var Ht = W(), Ut = m().uniqueId;
    Z.exports = { run: Jt, undo: Qt };
    function Jt(e) {
      (e.graph().acyclicer === "greedy" ? Ht(e, r(e)) : Kt(e)).forEach((n) => {
        let i = e.edge(n);
        e.removeEdge(n), i.forwardName = n.name, i.reversed = true, e.setEdge(n.w, n.v, i, Ut("rev"));
      });
      function r(n) {
        return (i) => n.edge(i).weight;
      }
    }
    function Kt(e) {
      let t = [], r = {}, n = {};
      function i(a) {
        Object.hasOwn(n, a) || (n[a] = true, r[a] = true, e.outEdges(a).forEach((o) => {
          Object.hasOwn(r, o.w) ? t.push(o) : i(o.w);
        }), delete r[a]);
      }
      return e.nodes().forEach(i), t;
    }
    function Qt(e) {
      e.edges().forEach((t) => {
        let r = e.edge(t);
        if (r.reversed) {
          e.removeEdge(t);
          let n = r.forwardName;
          delete r.reversed, delete r.forwardName, e.setEdge(t.w, t.v, r, n);
        }
      });
    }
  });
  var te = p((li, ee) => {
    var Zt = m();
    ee.exports = { run: $t, undo: tr };
    function $t(e) {
      e.graph().dummyChains = [], e.edges().forEach((t) => er(e, t));
    }
    function er(e, t) {
      let r = t.v, n = e.node(r).rank, i = t.w, a = e.node(i).rank, o = t.name, l = e.edge(t), s = l.labelRank;
      if (a === n + 1)
        return;
      e.removeEdge(t);
      let d, u, h;
      for (h = 0, ++n;n < a; ++h, ++n)
        l.points = [], u = { width: 0, height: 0, edgeLabel: l, edgeObj: t, rank: n }, d = Zt.addDummyNode(e, "edge", u, "_d"), n === s && (u.width = l.width, u.height = l.height, u.dummy = "edge-label", u.labelpos = l.labelpos), e.setEdge(r, d, { weight: l.weight }, o), h === 0 && e.graph().dummyChains.push(d), r = d;
      e.setEdge(r, i, { weight: l.weight }, o);
    }
    function tr(e) {
      e.graph().dummyChains.forEach((t) => {
        let r = e.node(t), n = r.edgeLabel, i;
        for (e.setEdge(r.edgeObj, n);r.dummy; )
          i = e.successors(t)[0], e.removeNode(t), n.points.push({ x: r.x, y: r.y }), r.dummy === "edge-label" && (n.x = r.x, n.y = r.y, n.width = r.width, n.height = r.height), t = i, r = e.node(t);
      });
    }
  });
  var y = p((si, re) => {
    var { applyWithChunking: rr } = m();
    re.exports = { longestPath: nr, slack: ir };
    function nr(e) {
      var t = {};
      function r(n) {
        var i = e.node(n);
        if (Object.hasOwn(t, n))
          return i.rank;
        t[n] = true;
        let a = e.outEdges(n).map((l) => l == null ? Number.POSITIVE_INFINITY : r(l.w) - e.edge(l).minlen);
        var o = rr(Math.min, a);
        return o === Number.POSITIVE_INFINITY && (o = 0), i.rank = o;
      }
      e.sources().forEach(r);
    }
    function ir(e, t) {
      return e.node(t.w).rank - e.node(t.v).rank - e.edge(t).minlen;
    }
  });
  var M = p((di, ne) => {
    var or = require_graphlib().Graph, N = y().slack;
    ne.exports = ar;
    function ar(e) {
      var t = new or({ directed: false }), r = e.nodes()[0], n = e.nodeCount();
      t.setNode(r, {});
      for (var i, a;lr(t, e) < n; )
        i = sr(t, e), a = t.hasNode(i.v) ? N(e, i) : -N(e, i), dr(t, e, a);
      return t;
    }
    function lr(e, t) {
      function r(n) {
        t.nodeEdges(n).forEach((i) => {
          var a = i.v, o = n === a ? i.w : a;
          !e.hasNode(o) && !N(t, i) && (e.setNode(o, {}), e.setEdge(n, o, {}), r(o));
        });
      }
      return e.nodes().forEach(r), e.nodeCount();
    }
    function sr(e, t) {
      return t.edges().reduce((n, i) => {
        let a = Number.POSITIVE_INFINITY;
        return e.hasNode(i.v) !== e.hasNode(i.w) && (a = N(t, i)), a < n[0] ? [a, i] : n;
      }, [Number.POSITIVE_INFINITY, null])[1];
    }
    function dr(e, t, r) {
      e.nodes().forEach((n) => t.node(n).rank += r);
    }
  });
  var fe = p((ui, he) => {
    var ur = M(), ie = y().slack, hr = y().longestPath, fr = require_graphlib().alg.preorder, cr = require_graphlib().alg.postorder, pr = m().simplify;
    he.exports = x;
    x.initLowLimValues = j;
    x.initCutValues = T;
    x.calcCutValue = ae;
    x.leaveEdge = se;
    x.enterEdge = de;
    x.exchangeEdges = ue;
    function x(e) {
      e = pr(e), hr(e);
      var t = ur(e);
      j(t), T(t, e);
      for (var r, n;r = se(t); )
        n = de(t, e, r), ue(t, e, r, n);
    }
    function T(e, t) {
      var r = cr(e, e.nodes());
      r = r.slice(0, r.length - 1), r.forEach((n) => mr(e, t, n));
    }
    function mr(e, t, r) {
      var n = e.node(r), i = n.parent;
      e.edge(r, i).cutvalue = ae(e, t, r);
    }
    function ae(e, t, r) {
      var n = e.node(r), i = n.parent, a = true, o = t.edge(r, i), l = 0;
      return o || (a = false, o = t.edge(i, r)), l = o.weight, t.nodeEdges(r).forEach((s) => {
        var d = s.v === r, u = d ? s.w : s.v;
        if (u !== i) {
          var h = d === a, f = t.edge(s).weight;
          if (l += h ? f : -f, wr(e, r, u)) {
            var c = e.edge(r, u).cutvalue;
            l += h ? -c : c;
          }
        }
      }), l;
    }
    function j(e, t) {
      arguments.length < 2 && (t = e.nodes()[0]), le(e, {}, 1, t);
    }
    function le(e, t, r, n, i) {
      var a = r, o = e.node(n);
      return t[n] = true, e.neighbors(n).forEach((l) => {
        Object.hasOwn(t, l) || (r = le(e, t, r, l, n));
      }), o.low = a, o.lim = r++, i ? o.parent = i : delete o.parent, r;
    }
    function se(e) {
      return e.edges().find((t) => e.edge(t).cutvalue < 0);
    }
    function de(e, t, r) {
      var { v: n, w: i } = r;
      t.hasEdge(n, i) || (n = r.w, i = r.v);
      var a = e.node(n), o = e.node(i), l = a, s = false;
      a.lim > o.lim && (l = o, s = true);
      var d = t.edges().filter((u) => s === oe(e, e.node(u.v), l) && s !== oe(e, e.node(u.w), l));
      return d.reduce((u, h) => ie(t, h) < ie(t, u) ? h : u);
    }
    function ue(e, t, r, n) {
      var { v: i, w: a } = r;
      e.removeEdge(i, a), e.setEdge(n.v, n.w, {}), j(e), T(e, t), br(e, t);
    }
    function br(e, t) {
      var r = e.nodes().find((i) => !t.node(i).parent), n = fr(e, r);
      n = n.slice(1), n.forEach((i) => {
        var a = e.node(i).parent, o = t.edge(i, a), l = false;
        o || (o = t.edge(a, i), l = true), t.node(i).rank = t.node(a).rank + (l ? o.minlen : -o.minlen);
      });
    }
    function wr(e, t, r) {
      return e.hasEdge(t, r);
    }
    function oe(e, t, r) {
      return r.low <= t.lim && t.lim <= r.lim;
    }
  });
  var be = p((hi, me) => {
    var Er = y(), pe = Er.longestPath, gr = M(), kr = fe();
    me.exports = xr;
    function xr(e) {
      var t = e.graph().ranker;
      if (t instanceof Function)
        return t(e);
      switch (e.graph().ranker) {
        case "network-simplex":
          ce(e);
          break;
        case "tight-tree":
          vr(e);
          break;
        case "longest-path":
          yr(e);
          break;
        case "none":
          break;
        default:
          ce(e);
      }
    }
    var yr = pe;
    function vr(e) {
      pe(e), gr(e);
    }
    function ce(e) {
      kr(e);
    }
  });
  var Ee = p((fi, we) => {
    we.exports = Nr;
    function Nr(e) {
      let t = Ir(e);
      e.graph().dummyChains.forEach((r) => {
        let n = e.node(r), i = n.edgeObj, a = Or(e, t, i.v, i.w), o = a.path, l = a.lca, s = 0, d = o[s], u = true;
        for (;r !== i.w; ) {
          if (n = e.node(r), u) {
            for (;(d = o[s]) !== l && e.node(d).maxRank < n.rank; )
              s++;
            d === l && (u = false);
          }
          if (!u) {
            for (;s < o.length - 1 && e.node(d = o[s + 1]).minRank <= n.rank; )
              s++;
            d = o[s];
          }
          e.setParent(r, d), r = e.successors(r)[0];
        }
      });
    }
    function Or(e, t, r, n) {
      let i = [], a = [], o = Math.min(t[r].low, t[n].low), l = Math.max(t[r].lim, t[n].lim), s, d;
      s = r;
      do
        s = e.parent(s), i.push(s);
      while (s && (t[s].low > o || l > t[s].lim));
      for (d = s, s = n;(s = e.parent(s)) !== d; )
        a.push(s);
      return { path: i.concat(a.reverse()), lca: d };
    }
    function Ir(e) {
      let t = {}, r = 0;
      function n(i) {
        let a = r;
        e.children(i).forEach(n), t[i] = { low: a, lim: r++ };
      }
      return e.children().forEach(n), t;
    }
  });
  var xe = p((ci, ke) => {
    var O = m();
    ke.exports = { run: qr, cleanup: Cr };
    function qr(e) {
      let t = O.addDummyNode(e, "root", {}, "_root"), r = Lr(e), n = Object.values(r), i = O.applyWithChunking(Math.max, n) - 1, a = 2 * i + 1;
      e.graph().nestingRoot = t, e.edges().forEach((l) => e.edge(l).minlen *= a);
      let o = Rr(e) + 1;
      e.children().forEach((l) => ge(e, t, a, o, i, r, l)), e.graph().nodeRankFactor = a;
    }
    function ge(e, t, r, n, i, a, o) {
      let l = e.children(o);
      if (!l.length) {
        o !== t && e.setEdge(t, o, { weight: 0, minlen: r });
        return;
      }
      let s = O.addBorderNode(e, "_bt"), d = O.addBorderNode(e, "_bb"), u = e.node(o);
      e.setParent(s, o), u.borderTop = s, e.setParent(d, o), u.borderBottom = d, l.forEach((h) => {
        ge(e, t, r, n, i, a, h);
        let f = e.node(h), c = f.borderTop ? f.borderTop : h, b = f.borderBottom ? f.borderBottom : h, w = f.borderTop ? n : 2 * n, k = c !== b ? 1 : i - a[o] + 1;
        e.setEdge(s, c, { weight: w, minlen: k, nestingEdge: true }), e.setEdge(b, d, { weight: w, minlen: k, nestingEdge: true });
      }), e.parent(o) || e.setEdge(t, s, { weight: 0, minlen: i + a[o] });
    }
    function Lr(e) {
      var t = {};
      function r(n, i) {
        var a = e.children(n);
        a && a.length && a.forEach((o) => r(o, i + 1)), t[n] = i;
      }
      return e.children().forEach((n) => r(n, 1)), t;
    }
    function Rr(e) {
      return e.edges().reduce((t, r) => t + e.edge(r).weight, 0);
    }
    function Cr(e) {
      var t = e.graph();
      e.removeNode(t.nestingRoot), delete t.nestingRoot, e.edges().forEach((r) => {
        var n = e.edge(r);
        n.nestingEdge && e.removeEdge(r);
      });
    }
  });
  var Ne = p((pi, ve) => {
    var Mr = m();
    ve.exports = Tr;
    function Tr(e) {
      function t(r) {
        let n = e.children(r), i = e.node(r);
        if (n.length && n.forEach(t), Object.hasOwn(i, "minRank")) {
          i.borderLeft = [], i.borderRight = [];
          for (let a = i.minRank, o = i.maxRank + 1;a < o; ++a)
            ye(e, "borderLeft", "_bl", r, i, a), ye(e, "borderRight", "_br", r, i, a);
        }
      }
      e.children().forEach(t);
    }
    function ye(e, t, r, n, i, a) {
      let o = { width: 0, height: 0, rank: a, borderType: t }, l = i[t][a - 1], s = Mr.addDummyNode(e, "border", o, r);
      i[t][a] = s, e.setParent(s, n), l && e.setEdge(l, s, { weight: 1 });
    }
  });
  var Le = p((mi, qe) => {
    qe.exports = { adjust: jr, undo: _r };
    function jr(e) {
      let t = e.graph().rankdir.toLowerCase();
      (t === "lr" || t === "rl") && Ie(e);
    }
    function _r(e) {
      let t = e.graph().rankdir.toLowerCase();
      (t === "bt" || t === "rl") && Sr(e), (t === "lr" || t === "rl") && (Pr(e), Ie(e));
    }
    function Ie(e) {
      e.nodes().forEach((t) => Oe(e.node(t))), e.edges().forEach((t) => Oe(e.edge(t)));
    }
    function Oe(e) {
      let t = e.width;
      e.width = e.height, e.height = t;
    }
    function Sr(e) {
      e.nodes().forEach((t) => _(e.node(t))), e.edges().forEach((t) => {
        let r = e.edge(t);
        r.points.forEach(_), Object.hasOwn(r, "y") && _(r);
      });
    }
    function _(e) {
      e.y = -e.y;
    }
    function Pr(e) {
      e.nodes().forEach((t) => S(e.node(t))), e.edges().forEach((t) => {
        let r = e.edge(t);
        r.points.forEach(S), Object.hasOwn(r, "x") && S(r);
      });
    }
    function S(e) {
      let t = e.x;
      e.x = e.y, e.y = t;
    }
  });
  var Me = p((bi, Ce) => {
    var Re = m();
    Ce.exports = Gr;
    function Gr(e) {
      let t = {}, r = e.nodes().filter((s) => !e.children(s).length), n = r.map((s) => e.node(s).rank), i = Re.applyWithChunking(Math.max, n), a = Re.range(i + 1).map(() => []);
      function o(s) {
        if (t[s])
          return;
        t[s] = true;
        let d = e.node(s);
        a[d.rank].push(s), e.successors(s).forEach(o);
      }
      return r.sort((s, d) => e.node(s).rank - e.node(d).rank).forEach(o), a;
    }
  });
  var je = p((wi, Te) => {
    var Vr = m().zipObject;
    Te.exports = Fr;
    function Fr(e, t) {
      let r = 0;
      for (let n = 1;n < t.length; ++n)
        r += Br(e, t[n - 1], t[n]);
      return r;
    }
    function Br(e, t, r) {
      let n = Vr(r, r.map((d, u) => u)), i = t.flatMap((d) => e.outEdges(d).map((u) => ({ pos: n[u.w], weight: e.edge(u).weight })).sort((u, h) => u.pos - h.pos)), a = 1;
      for (;a < r.length; )
        a <<= 1;
      let o = 2 * a - 1;
      a -= 1;
      let l = new Array(o).fill(0), s = 0;
      return i.forEach((d) => {
        let u = d.pos + a;
        l[u] += d.weight;
        let h = 0;
        for (;u > 0; )
          u % 2 && (h += l[u + 1]), u = u - 1 >> 1, l[u] += d.weight;
        s += d.weight * h;
      }), s;
    }
  });
  var Se = p((Ei, _e) => {
    _e.exports = Dr;
    function Dr(e, t = []) {
      return t.map((r) => {
        let n = e.inEdges(r);
        if (n.length) {
          let i = n.reduce((a, o) => {
            let l = e.edge(o), s = e.node(o.v);
            return { sum: a.sum + l.weight * s.order, weight: a.weight + l.weight };
          }, { sum: 0, weight: 0 });
          return { v: r, barycenter: i.sum / i.weight, weight: i.weight };
        } else
          return { v: r };
      });
    }
  });
  var Ge = p((gi, Pe) => {
    var Yr = m();
    Pe.exports = Ar;
    function Ar(e, t) {
      let r = {};
      e.forEach((i, a) => {
        let o = r[i.v] = { indegree: 0, in: [], out: [], vs: [i.v], i: a };
        i.barycenter !== undefined && (o.barycenter = i.barycenter, o.weight = i.weight);
      }), t.edges().forEach((i) => {
        let a = r[i.v], o = r[i.w];
        a !== undefined && o !== undefined && (o.indegree++, a.out.push(r[i.w]));
      });
      let n = Object.values(r).filter((i) => !i.indegree);
      return Wr(n);
    }
    function Wr(e) {
      let t = [];
      function r(i) {
        return (a) => {
          a.merged || (a.barycenter === undefined || i.barycenter === undefined || a.barycenter >= i.barycenter) && zr(i, a);
        };
      }
      function n(i) {
        return (a) => {
          a.in.push(i), --a.indegree === 0 && e.push(a);
        };
      }
      for (;e.length; ) {
        let i = e.pop();
        t.push(i), i.in.reverse().forEach(r(i)), i.out.forEach(n(i));
      }
      return t.filter((i) => !i.merged).map((i) => Yr.pick(i, ["vs", "i", "barycenter", "weight"]));
    }
    function zr(e, t) {
      let r = 0, n = 0;
      e.weight && (r += e.barycenter * e.weight, n += e.weight), t.weight && (r += t.barycenter * t.weight, n += t.weight), e.vs = t.vs.concat(e.vs), e.barycenter = r / n, e.weight = n, e.i = Math.min(t.i, e.i), t.merged = true;
    }
  });
  var Be = p((ki, Fe) => {
    var Xr = m();
    Fe.exports = Hr;
    function Hr(e, t) {
      let r = Xr.partition(e, (u) => Object.hasOwn(u, "barycenter")), n = r.lhs, i = r.rhs.sort((u, h) => h.i - u.i), a = [], o = 0, l = 0, s = 0;
      n.sort(Ur(!!t)), s = Ve(a, i, s), n.forEach((u) => {
        s += u.vs.length, a.push(u.vs), o += u.barycenter * u.weight, l += u.weight, s = Ve(a, i, s);
      });
      let d = { vs: a.flat(true) };
      return l && (d.barycenter = o / l, d.weight = l), d;
    }
    function Ve(e, t, r) {
      let n;
      for (;t.length && (n = t[t.length - 1]).i <= r; )
        t.pop(), e.push(n.vs), r++;
      return r;
    }
    function Ur(e) {
      return (t, r) => t.barycenter < r.barycenter ? -1 : t.barycenter > r.barycenter ? 1 : e ? r.i - t.i : t.i - r.i;
    }
  });
  var Ae = p((xi, Ye) => {
    var Jr = Se(), Kr = Ge(), Qr = Be();
    Ye.exports = De;
    function De(e, t, r, n) {
      let i = e.children(t), a = e.node(t), o = a ? a.borderLeft : undefined, l = a ? a.borderRight : undefined, s = {};
      o && (i = i.filter((f) => f !== o && f !== l));
      let d = Jr(e, i);
      d.forEach((f) => {
        if (e.children(f.v).length) {
          let c = De(e, f.v, r, n);
          s[f.v] = c, Object.hasOwn(c, "barycenter") && $r(f, c);
        }
      });
      let u = Kr(d, r);
      Zr(u, s);
      let h = Qr(u, n);
      if (o && (h.vs = [o, h.vs, l].flat(true), e.predecessors(o).length)) {
        let f = e.node(e.predecessors(o)[0]), c = e.node(e.predecessors(l)[0]);
        Object.hasOwn(h, "barycenter") || (h.barycenter = 0, h.weight = 0), h.barycenter = (h.barycenter * h.weight + f.order + c.order) / (h.weight + 2), h.weight += 2;
      }
      return h;
    }
    function Zr(e, t) {
      e.forEach((r) => {
        r.vs = r.vs.flatMap((n) => t[n] ? t[n].vs : n);
      });
    }
    function $r(e, t) {
      e.barycenter !== undefined ? (e.barycenter = (e.barycenter * e.weight + t.barycenter * t.weight) / (e.weight + t.weight), e.weight += t.weight) : (e.barycenter = t.barycenter, e.weight = t.weight);
    }
  });
  var ze = p((yi, We) => {
    var en = require_graphlib().Graph, tn = m();
    We.exports = rn;
    function rn(e, t, r, n) {
      n || (n = e.nodes());
      let i = nn(e), a = new en({ compound: true }).setGraph({ root: i }).setDefaultNodeLabel((o) => e.node(o));
      return n.forEach((o) => {
        let l = e.node(o), s = e.parent(o);
        (l.rank === t || l.minRank <= t && t <= l.maxRank) && (a.setNode(o), a.setParent(o, s || i), e[r](o).forEach((d) => {
          let u = d.v === o ? d.w : d.v, h = a.edge(u, o), f = h !== undefined ? h.weight : 0;
          a.setEdge(u, o, { weight: e.edge(d).weight + f });
        }), Object.hasOwn(l, "minRank") && a.setNode(o, { borderLeft: l.borderLeft[t], borderRight: l.borderRight[t] }));
      }), a;
    }
    function nn(e) {
      for (var t;e.hasNode(t = tn.uniqueId("_root")); )
        ;
      return t;
    }
  });
  var He = p((vi, Xe) => {
    Xe.exports = on;
    function on(e, t, r) {
      let n = {}, i;
      r.forEach((a) => {
        let o = e.parent(a), l, s;
        for (;o; ) {
          if (l = e.parent(o), l ? (s = n[l], n[l] = o) : (s = i, i = o), s && s !== o) {
            t.setEdge(s, o);
            return;
          }
          o = l;
        }
      });
    }
  });
  var Ze = p((Ni, Qe) => {
    var an = Me(), ln = je(), sn = Ae(), dn = ze(), un = He(), hn = require_graphlib().Graph, I = m();
    Qe.exports = Ke;
    function Ke(e, t = {}) {
      if (typeof t.customOrder == "function") {
        t.customOrder(e, Ke);
        return;
      }
      let r = I.maxRank(e), n = Ue(e, I.range(1, r + 1), "inEdges"), i = Ue(e, I.range(r - 1, -1, -1), "outEdges"), a = an(e);
      if (Je(e, a), t.disableOptimalOrderHeuristic)
        return;
      let o = Number.POSITIVE_INFINITY, l, s = t.constraints || [];
      for (let d = 0, u = 0;u < 4; ++d, ++u) {
        fn(d % 2 ? n : i, d % 4 >= 2, s), a = I.buildLayerMatrix(e);
        let h = ln(e, a);
        h < o ? (u = 0, l = Object.assign({}, a), o = h) : h === o && (l = structuredClone(a));
      }
      Je(e, l);
    }
    function Ue(e, t, r) {
      let n = new Map, i = (a, o) => {
        n.has(a) || n.set(a, []), n.get(a).push(o);
      };
      for (let a of e.nodes()) {
        let o = e.node(a);
        if (typeof o.rank == "number" && i(o.rank, a), typeof o.minRank == "number" && typeof o.maxRank == "number")
          for (let l = o.minRank;l <= o.maxRank; l++)
            l !== o.rank && i(l, a);
      }
      return t.map(function(a) {
        return dn(e, a, r, n.get(a) || []);
      });
    }
    function fn(e, t, r) {
      let n = new hn;
      e.forEach(function(i) {
        r.forEach((l) => n.setEdge(l.left, l.right));
        let a = i.graph().root, o = sn(i, a, n, t);
        o.vs.forEach((l, s) => i.node(l).order = s), un(i, n, o.vs);
      });
    }
    function Je(e, t) {
      Object.values(t).forEach((r) => r.forEach((n, i) => e.node(n).order = i));
    }
  });
  var st = p((Oi, lt) => {
    var cn = require_graphlib().Graph, g = m();
    lt.exports = { positionX: bn, findType1Conflicts: $e, findType2Conflicts: et, addConflict: P, hasConflict: tt, verticalAlignment: rt, horizontalCompaction: nt, alignCoordinates: ot, findSmallestWidthAlignment: it, balance: at };
    function $e(e, t) {
      let r = {};
      function n(i, a) {
        let o = 0, l = 0, s = i.length, d = a[a.length - 1];
        return a.forEach((u, h) => {
          let f = pn(e, u), c = f ? e.node(f).order : s;
          (f || u === d) && (a.slice(l, h + 1).forEach((b) => {
            e.predecessors(b).forEach((w) => {
              let k = e.node(w), F = k.order;
              (F < o || c < F) && !(k.dummy && e.node(b).dummy) && P(r, w, b);
            });
          }), l = h + 1, o = c);
        }), a;
      }
      return t.length && t.reduce(n), r;
    }
    function et(e, t) {
      let r = {};
      function n(a, o, l, s, d) {
        let u;
        g.range(o, l).forEach((h) => {
          u = a[h], e.node(u).dummy && e.predecessors(u).forEach((f) => {
            let c = e.node(f);
            c.dummy && (c.order < s || c.order > d) && P(r, f, u);
          });
        });
      }
      function i(a, o) {
        let l = -1, s, d = 0;
        return o.forEach((u, h) => {
          if (e.node(u).dummy === "border") {
            let f = e.predecessors(u);
            f.length && (s = e.node(f[0]).order, n(o, d, h, l, s), d = h, l = s);
          }
          n(o, d, o.length, s, a.length);
        }), o;
      }
      return t.length && t.reduce(i), r;
    }
    function pn(e, t) {
      if (e.node(t).dummy)
        return e.predecessors(t).find((r) => e.node(r).dummy);
    }
    function P(e, t, r) {
      if (t > r) {
        let i = t;
        t = r, r = i;
      }
      let n = e[t];
      n || (e[t] = n = {}), n[r] = true;
    }
    function tt(e, t, r) {
      if (t > r) {
        let n = t;
        t = r, r = n;
      }
      return !!e[t] && Object.hasOwn(e[t], r);
    }
    function rt(e, t, r, n) {
      let i = {}, a = {}, o = {};
      return t.forEach((l) => {
        l.forEach((s, d) => {
          i[s] = s, a[s] = s, o[s] = d;
        });
      }), t.forEach((l) => {
        let s = -1;
        l.forEach((d) => {
          let u = n(d);
          if (u.length) {
            u = u.sort((f, c) => o[f] - o[c]);
            let h = (u.length - 1) / 2;
            for (let f = Math.floor(h), c = Math.ceil(h);f <= c; ++f) {
              let b = u[f];
              a[d] === d && s < o[b] && !tt(r, d, b) && (a[b] = d, a[d] = i[d] = i[b], s = o[b]);
            }
          }
        });
      }), { root: i, align: a };
    }
    function nt(e, t, r, n, i) {
      let a = {}, o = mn(e, t, r, i), l = i ? "borderLeft" : "borderRight";
      function s(h, f) {
        let c = o.nodes().slice(), b = {}, w = c.pop();
        for (;w; ) {
          if (b[w])
            h(w);
          else {
            b[w] = true, c.push(w);
            for (let k of f(w))
              c.push(k);
          }
          w = c.pop();
        }
      }
      function d(h) {
        a[h] = o.inEdges(h).reduce((f, c) => Math.max(f, a[c.v] + o.edge(c)), 0);
      }
      function u(h) {
        let f = o.outEdges(h).reduce((b, w) => Math.min(b, a[w.w] - o.edge(w)), Number.POSITIVE_INFINITY), c = e.node(h);
        f !== Number.POSITIVE_INFINITY && c.borderType !== l && (a[h] = Math.max(a[h], f));
      }
      return s(d, o.predecessors.bind(o)), s(u, o.successors.bind(o)), Object.keys(n).forEach((h) => a[h] = a[r[h]]), a;
    }
    function mn(e, t, r, n) {
      let i = new cn, a = e.graph(), o = wn(a.nodesep, a.edgesep, n);
      return t.forEach((l) => {
        let s;
        l.forEach((d) => {
          let u = r[d];
          if (i.setNode(u), s) {
            var h = r[s], f = i.edge(h, u);
            i.setEdge(h, u, Math.max(o(e, d, s), f || 0));
          }
          s = d;
        });
      }), i;
    }
    function it(e, t) {
      return Object.values(t).reduce((r, n) => {
        let { NEGATIVE_INFINITY: i, POSITIVE_INFINITY: a } = Number;
        Object.entries(n).forEach(([l, s]) => {
          let d = En(e, l) / 2;
          i = Math.max(s + d, i), a = Math.min(s - d, a);
        });
        let o = i - a;
        return o < r[0] && (r = [o, n]), r;
      }, [Number.POSITIVE_INFINITY, null])[1];
    }
    function ot(e, t) {
      let r = Object.values(t), n = g.applyWithChunking(Math.min, r), i = g.applyWithChunking(Math.max, r);
      ["u", "d"].forEach((a) => {
        ["l", "r"].forEach((o) => {
          let l = a + o, s = e[l];
          if (s === t)
            return;
          let d = Object.values(s), u = n - g.applyWithChunking(Math.min, d);
          o !== "l" && (u = i - g.applyWithChunking(Math.max, d)), u && (e[l] = g.mapValues(s, (h) => h + u));
        });
      });
    }
    function at(e, t) {
      return g.mapValues(e.ul, (r, n) => {
        if (t)
          return e[t.toLowerCase()][n];
        {
          let i = Object.values(e).map((a) => a[n]).sort((a, o) => a - o);
          return (i[1] + i[2]) / 2;
        }
      });
    }
    function bn(e) {
      let t = g.buildLayerMatrix(e), r = Object.assign($e(e, t), et(e, t)), n = {}, i;
      ["u", "d"].forEach((o) => {
        i = o === "u" ? t : Object.values(t).reverse(), ["l", "r"].forEach((l) => {
          l === "r" && (i = i.map((h) => Object.values(h).reverse()));
          let s = (o === "u" ? e.predecessors : e.successors).bind(e), d = rt(e, i, r, s), u = nt(e, i, d.root, d.align, l === "r");
          l === "r" && (u = g.mapValues(u, (h) => -h)), n[o + l] = u;
        });
      });
      let a = it(e, n);
      return ot(n, a), at(n, e.graph().align);
    }
    function wn(e, t, r) {
      return (n, i, a) => {
        let o = n.node(i), l = n.node(a), s = 0, d;
        if (s += o.width / 2, Object.hasOwn(o, "labelpos"))
          switch (o.labelpos.toLowerCase()) {
            case "l":
              d = -o.width / 2;
              break;
            case "r":
              d = o.width / 2;
              break;
          }
        if (d && (s += r ? d : -d), d = 0, s += (o.dummy ? t : e) / 2, s += (l.dummy ? t : e) / 2, s += l.width / 2, Object.hasOwn(l, "labelpos"))
          switch (l.labelpos.toLowerCase()) {
            case "l":
              d = l.width / 2;
              break;
            case "r":
              d = -l.width / 2;
              break;
          }
        return d && (s += r ? d : -d), d = 0, s;
      };
    }
    function En(e, t) {
      return e.node(t).width;
    }
  });
  var ht = p((Ii, ut) => {
    var dt = m(), gn = st().positionX;
    ut.exports = kn;
    function kn(e) {
      e = dt.asNonCompoundGraph(e), xn(e), Object.entries(gn(e)).forEach(([t, r]) => e.node(t).x = r);
    }
    function xn(e) {
      let t = dt.buildLayerMatrix(e), r = e.graph().ranksep, n = 0;
      t.forEach((i) => {
        let a = i.reduce((o, l) => {
          let s = e.node(l).height;
          return o > s ? o : s;
        }, 0);
        i.forEach((o) => e.node(o).y = n + a / 2), n += a + r;
      });
    }
  });
  var Et = p((qi, wt) => {
    var ft = $(), ct = te(), yn = be(), vn = m().normalizeRanks, Nn = Ee(), On = m().removeEmptyRanks, pt = xe(), In = Ne(), mt = Le(), qn = Ze(), Ln = ht(), E = m(), Rn = require_graphlib().Graph;
    wt.exports = Cn;
    function Cn(e, t = {}) {
      let r = t.debugTiming ? E.time : E.notime;
      return r("layout", () => {
        let n = r("  buildLayoutGraph", () => Bn(e));
        return r("  runLayout", () => Mn(n, r, t)), r("  updateInputGraph", () => Tn(e, n)), n;
      });
    }
    function Mn(e, t, r) {
      t("    makeSpaceForEdgeLabels", () => Dn(e)), t("    removeSelfEdges", () => Kn(e)), t("    acyclic", () => ft.run(e)), t("    nestingGraph.run", () => pt.run(e)), t("    rank", () => yn(E.asNonCompoundGraph(e))), t("    injectEdgeLabelProxies", () => Yn(e)), t("    removeEmptyRanks", () => On(e)), t("    nestingGraph.cleanup", () => pt.cleanup(e)), t("    normalizeRanks", () => vn(e)), t("    assignRankMinMax", () => An(e)), t("    removeEdgeLabelProxies", () => Wn(e)), t("    normalize.run", () => ct.run(e)), t("    parentDummyChains", () => Nn(e)), t("    addBorderSegments", () => In(e)), t("    order", () => qn(e, r)), t("    insertSelfEdges", () => Qn(e)), t("    adjustCoordinateSystem", () => mt.adjust(e)), t("    position", () => Ln(e)), t("    positionSelfEdges", () => Zn(e)), t("    removeBorderNodes", () => Jn(e)), t("    normalize.undo", () => ct.undo(e)), t("    fixupEdgeLabelCoords", () => Hn(e)), t("    undoCoordinateSystem", () => mt.undo(e)), t("    translateGraph", () => zn(e)), t("    assignNodeIntersects", () => Xn(e)), t("    reversePoints", () => Un(e)), t("    acyclic.undo", () => ft.undo(e));
    }
    function Tn(e, t) {
      e.nodes().forEach((r) => {
        let n = e.node(r), i = t.node(r);
        n && (n.x = i.x, n.y = i.y, n.order = i.order, n.rank = i.rank, t.children(r).length && (n.width = i.width, n.height = i.height));
      }), e.edges().forEach((r) => {
        let n = e.edge(r), i = t.edge(r);
        n.points = i.points, Object.hasOwn(i, "x") && (n.x = i.x, n.y = i.y);
      }), e.graph().width = t.graph().width, e.graph().height = t.graph().height;
    }
    var jn = ["nodesep", "edgesep", "ranksep", "marginx", "marginy"], _n = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: "tb" }, Sn = ["acyclicer", "ranker", "rankdir", "align"], Pn = ["width", "height", "rank"], bt = { width: 0, height: 0 }, Gn = ["minlen", "weight", "width", "height", "labeloffset"], Vn = { minlen: 1, weight: 1, width: 0, height: 0, labeloffset: 10, labelpos: "r" }, Fn = ["labelpos"];
    function Bn(e) {
      let t = new Rn({ multigraph: true, compound: true }), r = V(e.graph());
      return t.setGraph(Object.assign({}, _n, G(r, jn), E.pick(r, Sn))), e.nodes().forEach((n) => {
        let i = V(e.node(n)), a = G(i, Pn);
        Object.keys(bt).forEach((o) => {
          a[o] === undefined && (a[o] = bt[o]);
        }), t.setNode(n, a), t.setParent(n, e.parent(n));
      }), e.edges().forEach((n) => {
        let i = V(e.edge(n));
        t.setEdge(n, Object.assign({}, Vn, G(i, Gn), E.pick(i, Fn)));
      }), t;
    }
    function Dn(e) {
      let t = e.graph();
      t.ranksep /= 2, e.edges().forEach((r) => {
        let n = e.edge(r);
        n.minlen *= 2, n.labelpos.toLowerCase() !== "c" && (t.rankdir === "TB" || t.rankdir === "BT" ? n.width += n.labeloffset : n.height += n.labeloffset);
      });
    }
    function Yn(e) {
      e.edges().forEach((t) => {
        let r = e.edge(t);
        if (r.width && r.height) {
          let n = e.node(t.v), a = { rank: (e.node(t.w).rank - n.rank) / 2 + n.rank, e: t };
          E.addDummyNode(e, "edge-proxy", a, "_ep");
        }
      });
    }
    function An(e) {
      let t = 0;
      e.nodes().forEach((r) => {
        let n = e.node(r);
        n.borderTop && (n.minRank = e.node(n.borderTop).rank, n.maxRank = e.node(n.borderBottom).rank, t = Math.max(t, n.maxRank));
      }), e.graph().maxRank = t;
    }
    function Wn(e) {
      e.nodes().forEach((t) => {
        let r = e.node(t);
        r.dummy === "edge-proxy" && (e.edge(r.e).labelRank = r.rank, e.removeNode(t));
      });
    }
    function zn(e) {
      let t = Number.POSITIVE_INFINITY, r = 0, n = Number.POSITIVE_INFINITY, i = 0, a = e.graph(), o = a.marginx || 0, l = a.marginy || 0;
      function s(d) {
        let { x: u, y: h, width: f, height: c } = d;
        t = Math.min(t, u - f / 2), r = Math.max(r, u + f / 2), n = Math.min(n, h - c / 2), i = Math.max(i, h + c / 2);
      }
      e.nodes().forEach((d) => s(e.node(d))), e.edges().forEach((d) => {
        let u = e.edge(d);
        Object.hasOwn(u, "x") && s(u);
      }), t -= o, n -= l, e.nodes().forEach((d) => {
        let u = e.node(d);
        u.x -= t, u.y -= n;
      }), e.edges().forEach((d) => {
        let u = e.edge(d);
        u.points.forEach((h) => {
          h.x -= t, h.y -= n;
        }), Object.hasOwn(u, "x") && (u.x -= t), Object.hasOwn(u, "y") && (u.y -= n);
      }), a.width = r - t + o, a.height = i - n + l;
    }
    function Xn(e) {
      e.edges().forEach((t) => {
        let r = e.edge(t), n = e.node(t.v), i = e.node(t.w), a, o;
        r.points ? (a = r.points[0], o = r.points[r.points.length - 1]) : (r.points = [], a = i, o = n), r.points.unshift(E.intersectRect(n, a)), r.points.push(E.intersectRect(i, o));
      });
    }
    function Hn(e) {
      e.edges().forEach((t) => {
        let r = e.edge(t);
        if (Object.hasOwn(r, "x"))
          switch ((r.labelpos === "l" || r.labelpos === "r") && (r.width -= r.labeloffset), r.labelpos) {
            case "l":
              r.x -= r.width / 2 + r.labeloffset;
              break;
            case "r":
              r.x += r.width / 2 + r.labeloffset;
              break;
          }
      });
    }
    function Un(e) {
      e.edges().forEach((t) => {
        let r = e.edge(t);
        r.reversed && r.points.reverse();
      });
    }
    function Jn(e) {
      e.nodes().forEach((t) => {
        if (e.children(t).length) {
          let r = e.node(t), n = e.node(r.borderTop), i = e.node(r.borderBottom), a = e.node(r.borderLeft[r.borderLeft.length - 1]), o = e.node(r.borderRight[r.borderRight.length - 1]);
          r.width = Math.abs(o.x - a.x), r.height = Math.abs(i.y - n.y), r.x = a.x + r.width / 2, r.y = n.y + r.height / 2;
        }
      }), e.nodes().forEach((t) => {
        e.node(t).dummy === "border" && e.removeNode(t);
      });
    }
    function Kn(e) {
      e.edges().forEach((t) => {
        if (t.v === t.w) {
          var r = e.node(t.v);
          r.selfEdges || (r.selfEdges = []), r.selfEdges.push({ e: t, label: e.edge(t) }), e.removeEdge(t);
        }
      });
    }
    function Qn(e) {
      var t = E.buildLayerMatrix(e);
      t.forEach((r) => {
        var n = 0;
        r.forEach((i, a) => {
          var o = e.node(i);
          o.order = a + n, (o.selfEdges || []).forEach((l) => {
            E.addDummyNode(e, "selfedge", { width: l.label.width, height: l.label.height, rank: o.rank, order: a + ++n, e: l.e, label: l.label }, "_se");
          }), delete o.selfEdges;
        });
      });
    }
    function Zn(e) {
      e.nodes().forEach((t) => {
        var r = e.node(t);
        if (r.dummy === "selfedge") {
          var n = e.node(r.e.v), i = n.x + n.width / 2, a = n.y, o = r.x - i, l = n.height / 2;
          e.setEdge(r.e, r.label), e.removeNode(t), r.label.points = [{ x: i + 2 * o / 3, y: a - l }, { x: i + 5 * o / 6, y: a - l }, { x: i + o, y: a }, { x: i + 5 * o / 6, y: a + l }, { x: i + 2 * o / 3, y: a + l }], r.label.x = r.x, r.label.y = r.y;
        }
      });
    }
    function G(e, t) {
      return E.mapValues(E.pick(e, t), Number);
    }
    function V(e) {
      var t = {};
      return e && Object.entries(e).forEach(([r, n]) => {
        typeof r == "string" && (r = r.toLowerCase()), t[r] = n;
      }), t;
    }
  });
  var kt = p((Li, gt) => {
    var $n = m(), ei = require_graphlib().Graph;
    gt.exports = { debugOrdering: ti };
    function ti(e) {
      let t = $n.buildLayerMatrix(e), r = new ei({ compound: true, multigraph: true }).setGraph({});
      return e.nodes().forEach((n) => {
        r.setNode(n, { label: n }), r.setParent(n, "layer" + e.node(n).rank);
      }), e.edges().forEach((n) => r.setEdge(n.v, n.w, {}, n.name)), t.forEach((n, i) => {
        let a = "layer" + i;
        r.setNode(a, { rank: "same" }), n.reduce((o, l) => (r.setEdge(o, l, { style: "invis" }), l));
      }), r;
    }
  });
  var yt = p((Ri, xt) => {
    xt.exports = "2.0.3";
  });
  module.exports = { graphlib: require_graphlib(), layout: Et(), debug: kt(), util: { time: m().time, notime: m().notime }, version: yt() };
  /*! For license information please see dagre.cjs.js.LEGAL.txt */
});
export default require_dagre_cjs();
