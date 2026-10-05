import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const menuPath='src/eretail/menuData.ts',appPath='src/App.tsx';
const menuSource=readFileSync(menuPath,'utf8'),appSource=readFileSync(appPath,'utf8'),serverSource=readFileSync('server.js','utf8');
const menuAst=ts.createSourceFile(menuPath,menuSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const appAst=ts.createSourceFile(appPath,appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const line=(ast,node)=>ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;
function value(node){
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
  if(ts.isArrayLiteralExpression(node))return node.elements.map(value);
  if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText().replace(/^['"]|['"]$/g,''),value(p.initializer)]));
  if(ts.isCallExpression(node)&&node.expression.getText()==='g'&&node.arguments[0])return `/app/m/${value(node.arguments[0])}`;
  return undefined;
}
let rail=[];
function findRail(node){if(ts.isVariableDeclaration(node)&&node.name.getText()==='RAIL')rail=value(node.initializer);ts.forEachChild(node,findRail);}findRail(menuAst);
const items=[];
for(const entry of rail){
  if(entry.single)items.push({rail:entry.title,group:'rail icon',label:entry.title,route:entry.single,source:`${menuPath}:${menuSource.slice(0,menuSource.indexOf(`key: '${entry.key}'`)).split('\n').length}`});
  for(const col of entry.columns||[])for(const group of col.groups||[])for(const item of group.items||[]){
    const re=new RegExp(`label: ['"]${item.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}['"]`);
    const match=re.exec(menuSource);const at=match?menuSource.slice(0,match.index).split('\n').length:null;
    items.push({rail:entry.title,group:group.title||'(none)',label:item.label,route:item.to||null,source:`${menuPath}:${at}`});
  }
}
const imports={};
const componentFile=spec=>`src/${resolve(dirname(appPath),spec).replace(resolve('src')+'/','')}`;
function dynamicImportSource(node){if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))return node.arguments[0].text;let found=null;ts.forEachChild(node,child=>{found??=dynamicImportSource(child)});return found;}
function collectImports(node){if(ts.isImportDeclaration(node)&&node.importClause){const path=componentFile(node.moduleSpecifier.text);if(node.importClause.name)imports[node.importClause.name.text]=path;if(node.importClause.namedBindings&&ts.isNamedImports(node.importClause.namedBindings))for(const e of node.importClause.namedBindings.elements)imports[e.name.text]=path;}if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){const spec=dynamicImportSource(node.initializer);if(spec)imports[node.name.text]=componentFile(spec);}ts.forEachChild(node,collectImports);}collectImports(appAst);
const routes=[];
function collectRoutes(node){
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText()==='Route'){
    const pathAttr=node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.text==='path');
    const elAttr=node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.text==='element');
    if(pathAttr){const route=pathAttr.initializer&&ts.isStringLiteral(pathAttr.initializer)?pathAttr.initializer.text:pathAttr.initializer?.getText();const element=elAttr?.initializer?.getText()||'';const tags=[...element.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)].map(x=>x[1]).filter(x=>!['P','Shell'].includes(x));const component=tags.at(-1)||'unknown';routes.push({route,component,componentFile:imports[component]||null,source:`${appPath}:${line(appAst,node)}`,element:element.slice(0,160)});}
  }
  ts.forEachChild(node,collectRoutes);
}collectRoutes(appAst);
const apiRoutes=[...new Set([...serverSource.matchAll(/"(\/api\/[^"?]+)"\s*:/g),...serverSource.matchAll(/app\.use\(['"](\/api\/[^'"]+)['"],/g)].map(x=>x[1]))];
const hasApiRoute=path=>apiRoutes.some(route=>path===route||path.startsWith(route.replace(/\/$/,'')+'/'))||path.startsWith('/api/auth');
function matchRoute(route){if(!route)return null;return routes.find(r=>r.route===route)||routes.find(r=>r.route?.endsWith('/:screen')&&route.startsWith(r.route.slice(0,-8)))||routes.find(r=>r.route?.endsWith('/:key')&&route.startsWith(r.route.slice(0,-5)))||null;}
for(const item of items){
  const mapped=matchRoute(item.route);item.routeSource=mapped?.source||null;item.component=mapped?.component||null;item.componentFile=mapped?.componentFile||null;
  if(item.route?.startsWith('/app/m/')&&!mapped){const key=item.route.slice('/app/m/'.length);const special=['inv-move','inv-move-scan','inv-move-history','intercompany-move','bulk-lottables','stock-adjustment','outbound-gate-pass','outbound-memo','sku-transaction-history','sku-lot-transfer'];if(special.includes(key)){item.component='InventoryOperations';item.componentFile='src/pages/InventoryOperations.tsx';item.routeSource='src/App.tsx:190';}}
  if(item.componentFile&&!existsSync(item.componentFile))for(const ext of ['.tsx','.ts','.jsx','.js'])if(existsSync(item.componentFile+ext)){item.componentFile+=ext;break;}
  let source='';try{if(item.componentFile)source=readFileSync(item.componentFile,'utf8');}catch{}
  if(item.component==='ReportRoute')source+='\n'+readFileSync('src/eretail/ReportScreen.tsx','utf8');
  item.apiDependencies=[...new Set([...source.matchAll(/['"`](\/api\/[A-Za-z0-9_/-]+)/g)].map(x=>x[1]))];
  item.missingApi=item.apiDependencies.filter(x=>!hasApiRoute(x));
}
const output=resolve(process.env.NAVIGATION_AUDIT_OUTPUT||'artifacts/navigation-audit/static-inventory.json');
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),menuFile:menuPath,routerFile:appPath,items,routes,apiRoutes},null,2));
console.log(JSON.stringify({output,items:items.length,withoutTarget:items.filter(x=>!x.route).length,withoutRoute:items.filter(x=>x.route&&!x.component).length,staticRoutes:routes.length,missingApiReferences:[...new Set(items.flatMap(x=>x.missingApi))]},null,2));
