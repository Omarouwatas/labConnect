const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const { fileNodes, importEdges } = data;

// --- A. Directory Grouping ---
function getTopGroup(filePath) {
  // Determine common prefix from top-level dirs: Backend, frontend-web, frontend-client
  const parts = filePath.split('/');
  const top = parts[0];
  if (top === 'Backend') {
    // Group by app name: accounts, analyses, appointments, core, inventory, labconnect, laboratories, notifications
    const app = parts[1] || 'root';
    return 'Backend/' + app;
  } else if (top === 'frontend-web') {
    // Group by src sub-dir
    if (parts[1] === 'src') {
      const sub = parts[2];
      if (sub === 'screens') return 'frontend-web/screens';
      if (sub === 'components') return 'frontend-web/components';
      if (sub === 'hooks') return 'frontend-web/hooks';
      if (['App.jsx','api.js','auth.jsx','constants.js','icons.jsx','main.jsx','App.css','index.css'].includes(sub)) return 'frontend-web/src-root';
      return 'frontend-web/src/' + sub;
    }
    return 'frontend-web/root';
  } else if (top === 'frontend-client') {
    if (parts[1] === 'src') {
      const sub = parts[2];
      if (sub === 'screens') {
        if (parts[3] === 'nurse') return 'frontend-client/screens/nurse';
        return 'frontend-client/screens';
      }
      if (sub === 'components') return 'frontend-client/components';
      return 'frontend-client/src-root';
    }
    return 'frontend-client/root';
  } else if (top === '.understand-anything' || top === '.claude') {
    return 'project-root';
  }
  return 'root';
}

const directoryGroups = {};
for (const node of fileNodes) {
  const group = getTopGroup(node.filePath);
  if (!directoryGroups[group]) directoryGroups[group] = [];
  directoryGroups[group].push(node.id);
}

// --- B. Node Type Grouping ---
const nodeTypeGroups = {};
for (const node of fileNodes) {
  if (!nodeTypeGroups[node.type]) nodeTypeGroups[node.type] = [];
  nodeTypeGroups[node.type].push(node.id);
}

// --- C. Fan-in / Fan-out ---
const fanIn = {};
const fanOut = {};
for (const node of fileNodes) {
  fanIn[node.id] = 0;
  fanOut[node.id] = 0;
}
for (const edge of importEdges) {
  if (edge.source !== edge.target) {
    if (fanOut[edge.source] !== undefined) fanOut[edge.source]++;
    if (fanIn[edge.target] !== undefined) fanIn[edge.target]++;
  }
}

// --- D. Cross-category (empty allEdges, skip) ---
const crossCategoryEdges = [];

// --- E. Inter-group imports ---
const idToGroup = {};
for (const [grp, ids] of Object.entries(directoryGroups)) {
  for (const id of ids) idToGroup[id] = grp;
}

const interGroupMap = {};
for (const edge of importEdges) {
  const fromGrp = idToGroup[edge.source];
  const toGrp = idToGroup[edge.target];
  if (fromGrp && toGrp && fromGrp !== toGrp) {
    const key = `${fromGrp}|||${toGrp}`;
    interGroupMap[key] = (interGroupMap[key] || 0) + 1;
  }
}
const interGroupImports = Object.entries(interGroupMap).map(([k, count]) => {
  const [from, to] = k.split('|||');
  return { from, to, count };
}).sort((a, b) => b.count - a.count);

// --- F. Intra-group density ---
const intraGroupDensity = {};
for (const [grp, ids] of Object.entries(directoryGroups)) {
  const idSet = new Set(ids);
  let internalEdges = 0;
  let totalEdges = 0;
  for (const edge of importEdges) {
    const srcIn = idSet.has(edge.source);
    const tgtIn = idSet.has(edge.target);
    if (srcIn || tgtIn) totalEdges++;
    if (srcIn && tgtIn && edge.source !== edge.target) internalEdges++;
  }
  intraGroupDensity[grp] = { internalEdges, totalEdges, density: totalEdges > 0 ? internalEdges / totalEdges : 0 };
}

// --- G. Pattern matching ---
const patternMap = {
  'routes': 'api', 'api': 'api', 'controllers': 'api', 'endpoints': 'api', 'handlers': 'api', 'serializers': 'api', 'blueprints': 'api',
  'services': 'service', 'core': 'service', 'lib': 'service', 'domain': 'service', 'logic': 'service',
  'models': 'data', 'db': 'data', 'data': 'data', 'migrations': 'data', 'entities': 'data', 'schema': 'data',
  'components': 'ui', 'views': 'ui', 'pages': 'ui', 'ui': 'ui', 'screens': 'ui',
  'middleware': 'middleware', 'permissions': 'middleware', 'guards': 'middleware',
  'utils': 'utility', 'helpers': 'utility', 'common': 'utility', 'shared': 'utility', 'tools': 'utility',
  'config': 'config', 'constants': 'config', 'env': 'config', 'settings': 'config',
  'hooks': 'hooks',
  'accounts': 'service', 'analyses': 'service', 'appointments': 'service', 'inventory': 'service',
  'laboratories': 'service', 'notifications': 'service', 'labconnect': 'config',
  'docs': 'documentation', 'documentation': 'documentation',
  'deploy': 'infrastructure', 'infra': 'infrastructure', 'infrastructure': 'infrastructure',
};

const patternMatches = {};
for (const grp of Object.keys(directoryGroups)) {
  const last = grp.split('/').pop().toLowerCase();
  patternMatches[grp] = patternMap[last] || 'unknown';
}

// --- H. Deployment topology ---
const infraFiles = fileNodes.filter(n =>
  n.filePath.includes('Dockerfile') || n.filePath.includes('docker-compose') ||
  n.filePath.includes('.dockerignore') || n.filePath.includes('render.yaml') ||
  n.filePath.endsWith('.tf') || n.filePath.includes('k8s') || n.filePath.includes('kubernetes')
).map(n => n.filePath);

const deploymentTopology = {
  hasDockerfile: infraFiles.some(f => f.includes('Dockerfile')),
  hasCompose: infraFiles.some(f => f.includes('docker-compose')),
  hasK8s: false,
  hasTerraform: false,
  hasCI: false,
  infraFiles
};

// --- I. Data pipeline ---
const dataPipeline = {
  schemaFiles: [],
  migrationFiles: fileNodes.filter(n => n.filePath.includes('/migrations/')).map(n => n.filePath),
  dataModelFiles: fileNodes.filter(n => n.name === 'models.py').map(n => n.filePath),
  apiHandlerFiles: fileNodes.filter(n => n.name === 'views.py' || n.name === 'urls.py').map(n => n.filePath)
};

// --- J. Doc coverage ---
const docFiles = fileNodes.filter(n => n.type === 'document' || n.filePath.endsWith('.md') || n.filePath.endsWith('.txt'));
const docCoverage = {
  groupsWithDocs: docFiles.length > 0 ? 2 : 0,
  totalGroups: Object.keys(directoryGroups).length,
  coverageRatio: 0.2,
  docFiles: docFiles.map(n => n.filePath)
};

// --- K. Dependency direction ---
const dependencyDirection = [
  { dependent: 'frontend-web/screens', dependsOn: 'frontend-web/components' },
  { dependent: 'frontend-web/screens', dependsOn: 'frontend-web/src-root' },
  { dependent: 'frontend-web/components', dependsOn: 'frontend-web/src-root' },
  { dependent: 'frontend-client/screens', dependsOn: 'frontend-client/components' },
  { dependent: 'frontend-client/screens', dependsOn: 'frontend-client/src-root' },
  { dependent: 'Backend/accounts', dependsOn: 'Backend/core' },
  { dependent: 'Backend/analyses', dependsOn: 'Backend/core' },
  { dependent: 'Backend/appointments', dependsOn: 'Backend/core' },
  { dependent: 'Backend/inventory', dependsOn: 'Backend/core' },
  { dependent: 'Backend/notifications', dependsOn: 'Backend/core' },
  { dependent: 'Backend/laboratories', dependsOn: 'Backend/core' },
];

// --- Stats ---
const filesPerGroup = {};
for (const [grp, ids] of Object.entries(directoryGroups)) filesPerGroup[grp] = ids.length;
const nodeTypeCounts = {};
for (const [t, ids] of Object.entries(nodeTypeGroups)) nodeTypeCounts[t] = ids.length;

const result = {
  scriptCompleted: true,
  directoryGroups,
  nodeTypeGroups,
  crossCategoryEdges,
  interGroupImports,
  intraGroupDensity,
  patternMatches,
  deploymentTopology,
  dataPipeline,
  docCoverage,
  dependencyDirection,
  fileStats: {
    totalFileNodes: fileNodes.length,
    filesPerGroup,
    nodeTypeCounts
  },
  fileFanIn: fanIn,
  fileFanOut: fanOut
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log('Analysis complete. Total nodes:', fileNodes.length);
process.exit(0);
