#!/usr/bin/env node
const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (e) {
  console.error('Failed to parse input:', e.message);
  process.exit(1);
}

const { nodes, edges, layers } = data;

// Build node lookup
const nodeMap = {};
for (const n of nodes) {
  nodeMap[n.id] = n;
}

// A. Fan-In (how many nodes point TO each node)
const fanIn = {};
const fanOut = {};
for (const n of nodes) {
  fanIn[n.id] = 0;
  fanOut[n.id] = 0;
}

const importEdges = edges.filter(e => e.type === 'imports' || e.type === 'calls');

for (const e of importEdges) {
  if (fanIn[e.target] !== undefined) fanIn[e.target]++;
  if (fanOut[e.source] !== undefined) fanOut[e.source]++;
}

const fanInRanking = Object.entries(fanIn)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([id, count]) => ({ id, fanIn: count, name: nodeMap[id] ? nodeMap[id].name : id }));

const fanOutRanking = Object.entries(fanOut)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([id, count]) => ({ id, fanOut: count, name: nodeMap[id] ? nodeMap[id].name : id }));

// C. Entry point candidates
const entryFilenames = [
  'index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js',
  'mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py',
  '__main__.py','Application.java','Main.java','Program.cs','config.ru','index.php',
  'App.swift','Application.kt','main.cpp','main.c','App.js','App.jsx','main.jsx'
];

const totalNodes = nodes.length;
const fanOutValues = Object.values(fanOut).sort((a, b) => b - a);
const top10pct = fanOutValues[Math.floor(totalNodes * 0.1)] || 0;
const fanInValues = Object.values(fanIn).sort((a, b) => a - b);
const bottom25pct = fanInValues[Math.floor(totalNodes * 0.25)] || 0;

const scores = {};
for (const n of nodes) {
  let score = 0;
  const pathParts = n.filePath ? n.filePath.split('/') : [];
  const depth = pathParts.length - 1;

  if (n.type === 'document') {
    if (n.name === 'README.md' && depth === 0) score += 5;
    else if (n.name.endsWith('.md') && depth === 0) score += 2;
    else if (n.name === 'README_API.md') score += 3;
    else if (n.name === 'API.md' && depth === 0) score += 4;
  } else {
    if (entryFilenames.includes(n.name)) score += 3;
    if (depth <= 1) score += 1;
    if (fanOut[n.id] >= top10pct) score += 1;
    if (fanIn[n.id] <= bottom25pct) score += 1;
  }
  scores[n.id] = score;
}

const entryPointCandidates = Object.entries(scores)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([id, score]) => ({
    id,
    score,
    name: nodeMap[id] ? nodeMap[id].name : id,
    type: nodeMap[id] ? nodeMap[id].type : 'unknown',
    summary: nodeMap[id] ? nodeMap[id].summary : ''
  }));

// D. BFS from top code entry point
// Find top code entry (skip docs)
const topCodeEntry = entryPointCandidates.find(e => {
  const n = nodeMap[e.id];
  return n && n.type === 'file';
}) || entryPointCandidates[0];

const startNode = topCodeEntry ? topCodeEntry.id : nodes[0].id;

// Build adjacency: imports/calls forward
const adj = {};
for (const n of nodes) adj[n.id] = [];
for (const e of importEdges) {
  if (adj[e.source]) adj[e.source].push(e.target);
}

// BFS
const visited = new Set();
const queue = [[startNode, 0]];
const bfsOrder = [];
const depthMap = {};

while (queue.length > 0) {
  const [node, depth] = queue.shift();
  if (visited.has(node)) continue;
  visited.add(node);
  bfsOrder.push(node);
  depthMap[node] = depth;
  for (const neighbor of (adj[node] || [])) {
    if (!visited.has(neighbor)) {
      queue.push([neighbor, depth + 1]);
    }
  }
}

const byDepth = {};
for (const [id, d] of Object.entries(depthMap)) {
  if (!byDepth[d]) byDepth[d] = [];
  byDepth[d].push(id);
}

// E. Non-Code File Inventory
const nonCodeFiles = {
  documentation: [],
  infrastructure: [],
  data: [],
  config: []
};

for (const n of nodes) {
  const entry = { id: n.id, name: n.name, type: n.type, summary: n.summary };
  if (n.type === 'document') nonCodeFiles.documentation.push(entry);
  else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push(entry);
  else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push(entry);
  else if (n.type === 'config') nonCodeFiles.config.push(entry);
}

// F. Tightly coupled clusters
// Build bidirectional edge set
const edgeSet = new Set();
const bidirectional = [];
for (const e of importEdges) {
  edgeSet.add(`${e.source}|||${e.target}`);
}
for (const e of importEdges) {
  if (edgeSet.has(`${e.target}|||${e.source}`)) {
    const key = [e.source, e.target].sort().join('|||');
    if (!bidirectional.find(b => b.key === key)) {
      bidirectional.push({ key, nodes: [e.source, e.target] });
    }
  }
}

// Expand clusters
const clusters = [];
for (const pair of bidirectional) {
  const cluster = new Set(pair.nodes);
  // Find nodes that connect to 2+ existing members
  for (const n of nodes) {
    if (cluster.has(n.id)) continue;
    let connections = 0;
    for (const m of cluster) {
      if (edgeSet.has(`${n.id}|||${m}`) || edgeSet.has(`${m}|||${n.id}`)) connections++;
    }
    if (connections >= 2) cluster.add(n.id);
  }
  if (cluster.size >= 2 && cluster.size <= 5) {
    clusters.push({ nodes: Array.from(cluster) });
  }
}

// Deduplicate clusters
const seenClusters = new Set();
const uniqueClusters = [];
for (const c of clusters) {
  const key = c.nodes.slice().sort().join('|||');
  if (!seenClusters.has(key)) {
    seenClusters.add(key);
    uniqueClusters.push(c);
  }
}

// Count edges within each cluster
for (const c of uniqueClusters) {
  let count = 0;
  for (const a of c.nodes) {
    for (const b of c.nodes) {
      if (a !== b && edgeSet.has(`${a}|||${b}`)) count++;
    }
  }
  c.edgeCount = count;
}

uniqueClusters.sort((a, b) => b.edgeCount - a.edgeCount);
const topClusters = uniqueClusters.slice(0, 10);

// G. Layer list
const layerInfo = {
  count: layers.length,
  list: layers.map(l => ({ id: l.id, name: l.name, description: l.description }))
};

// H. Node Summary Index
const nodeSummaryIndex = {};
for (const n of nodes) {
  nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
}

const result = {
  scriptCompleted: true,
  entryPointCandidates,
  fanInRanking,
  fanOutRanking,
  bfsTraversal: {
    startNode,
    order: bfsOrder,
    depthMap,
    byDepth
  },
  nonCodeFiles,
  clusters: topClusters,
  layers: layerInfo,
  nodeSummaryIndex,
  totalNodes: nodes.length,
  totalEdges: edges.length
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log('Analysis complete. Nodes:', nodes.length, 'Edges:', edges.length);
process.exit(0);
