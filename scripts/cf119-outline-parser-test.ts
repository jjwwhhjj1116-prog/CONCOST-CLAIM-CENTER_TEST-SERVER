import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePreviewOutlineSuggestions } from '../apps/cloudflare/src/index';

test('CF119 actual outline parser preserves new AI titles and rejects incomplete or ambiguous proposals', () => {
  const prompts = ['CH-01','CH-02'].map((chapterCode,index)=>({
    id:'prompt-'+index,chapterCode,title:'기존 제목 '+index,claimType:'TYPE-01',typeName:'합성',setStatus:'ACTIVE',
    agentCode:'AGENT-01',rolePrompt:'합성',instructionPrompt:'합성',ordinal:index+1,version:1,updatedAt:'',
    updatedByName:'QA',systemPrompt:'합성',sourceCategoryCodesJson:null,sourceAnalysisNote:null,sourceAnalysisVersion:null
  }));
  const rows=prompts.map((prompt,index)=>({chapterCode:prompt.chapterCode,chapterTitle:'  AI 새 목차 '+index+'  ',planningNote:' 근거 검토 '+index+' '}));
  const expected=rows.map((row,index)=>({...row,chapterId:prompts[index].id,chapterTitle:row.chapterTitle.trim(),planningNote:row.planningNote.trim()}));
  assert.deepEqual(parsePreviewOutlineSuggestions(JSON.stringify({chapters:rows}),prompts),expected);
  assert.deepEqual(parsePreviewOutlineSuggestions('```json\n'+JSON.stringify(rows)+'\n```',prompts),expected);
  const invalid: [string,unknown][]=[
    ['missing title',[{chapterCode:'CH-01',planningNote:'근거'},rows[1]]],
    ['empty title',[{...rows[0],chapterTitle:'  '},rows[1]]],
    ['oversize title',[{...rows[0],chapterTitle:'가'.repeat(301)},rows[1]]],
    ['duplicate code',[rows[0],rows[0]]],
    ['unknown extra code',[...rows,{...rows[0],chapterCode:'CH-99'}]],
    ['missing code',[rows[0]]],
    ['invalid row',[...rows,null]],
    ['missing note',[{chapterCode:'CH-01',chapterTitle:'새 제목'},rows[1]]],
    ['oversize note',[{...rows[0],planningNote:'가'.repeat(2001)},rows[1]]]
  ];
  for(const [label,value] of invalid) assert.equal(parsePreviewOutlineSuggestions(JSON.stringify({chapters:value}),prompts),null,label);
  for(const raw of ['{invalid','{"chapters":null}','null','"text"']) assert.equal(parsePreviewOutlineSuggestions(raw,prompts),null,raw);
});
