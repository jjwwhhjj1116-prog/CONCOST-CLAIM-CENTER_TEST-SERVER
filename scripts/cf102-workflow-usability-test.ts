import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectScheduleMonths, schedulePrintPages } from '../apps/web/src/workflow/ProjectSchedulePrint';
import { qaProjects } from '../apps/web/qa/cf102-data';

test('CF102 detailed print covers every saved month, gaps and year boundaries',()=>{
  const project=qaProjects[0];
  assert.deepEqual(projectScheduleMonths(project,'2026-08'),['2026-09','2026-10']);
  assert.deepEqual(schedulePrintPages(qaProjects,project.id,'2026-08').map(p=>[p.month,p.projects.map(p=>p.id)]),[['2026-09',['project-1']],['2026-10',['project-1']]]);
  assert.deepEqual(projectScheduleMonths({...project,stages:[{...project.stages[0],startDate:'2026-12-31',endDate:'2027-02-01'}]},'2026-09'),['2026-12','2027-01','2027-02']);
  assert.deepEqual(projectScheduleMonths(qaProjects[1],'2026-09'),['2026-09']);
  assert.deepEqual(projectScheduleMonths({...project,stages:[{...project.stages[0],startDate:'2026-02-30',endDate:'2026-03-01'}]},'2026-09'),['2026-09']);
  assert.deepEqual(schedulePrintPages(qaProjects,'missing','2026-09'),[{month:'2026-09',projects:[]}]);
});
test('CF102 overview preserves eight-project pagination and selected month',()=>{
  const rows=Array.from({length:9},(_,i)=>({...qaProjects[0],id:String(i)}));
  const pages=schedulePrintPages(rows,'','2026-10');
  assert.deepEqual(pages.map(p=>p.projects.length),[8,1]);
  assert.ok(pages.every(p=>p.month==='2026-10'));
});
test('CF102 menus, exact reception navigation and optional email preserve workflow gates',()=>{
  const read=(path:string)=>readFileSync(`apps/web/src/${path}`,'utf8');
  const menus=read('documents/DocumentToolMenus.tsx');
  assert.match(menus,/addEventListener\('pointerdown', dismiss\)/);
  assert.match(menus,/removeEventListener\('keydown', escape, true\)/);
  assert.ok(menus.indexOf('if (menu) menu.open = false;')<menus.indexOf('action.onClick();'));
  assert.doesNotMatch(read('theme-system.css'),/document-tool-menu:(?:hover|focus-within)>/);
  const proposal=read('proposals/ProposalView.tsx');
  assert.match(proposal,/step===5&&activeProposal.status==='APPROVED'/);
  assert.match(proposal,/target===5&&activeProposal\?.status!=='APPROVED'/);
  assert.ok(proposal.indexOf('proposal-mail-preview')>proposal.indexOf('proposal-finalization-actions'));
  const confirm=proposal.slice(proposal.indexOf('const confirmProposal='),proposal.indexOf('const download='));
  assert.ok(confirm.indexOf('onNavigate(')>confirm.indexOf('await loadProposalDetail('));
  assert.match(confirm,/&proposalId=/);
  assert.match(read('workflow/ProposalAwardWorkflow.tsx'),/get\('proposalId'\)/);
  assert.match(read('workflow/ProjectWorkflowSchedule.tsx'),/className="schedule-pm-cell" role="cell"/);
});
