import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [configPath, systemPromptPath, outputPath, packageZipSha, reportZipSha, proposalZipSha] = process.argv.slice(2);
if (!configPath || !systemPromptPath || !outputPath || !packageZipSha || !reportZipSha || !proposalZipSha) {
  throw new Error('Usage: node generate-cf84-guideline-migration.mjs <config> <system-prompt> <output> <package-sha> <report-sha> <proposal-sha>');
}

const configBytes = readFileSync(configPath);
const config = JSON.parse(configBytes.toString('utf8'));
const configSha = createHash('sha256').update(configBytes).digest('hex');
const systemPrompt = readFileSync(systemPromptPath, 'utf8').trim();
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const jsonText = (value) => sqlText(JSON.stringify(value));
const typeCode = (id) => `TYPE-${id.slice(2).padStart(2, '0')}`;
const chapterCode = (order) => `CH-${String(order).padStart(2, '0')}`;
const sourceFile = (id) => `TYPE_${id.slice(2).padStart(2, '0')}_CLAIM_REPORT_GUIDELINE_PACKAGE.md`;

const profileToSource = {
  RP01: 'REF-01', RP02: 'REF-02', RP03: 'REF-03', RP04: 'REF-04', RP05: 'REF-05',
  RP06: 'REF-06', RP07: 'REF-07', RP08: 'REF-08', RP09: 'REF-09'
};

const categorySeeds = [
  ['REF-01','감정보완 신청서','TYPE-02',[],6,'감정인의 기존 의견과 문제점, 입증취지, 번호화된 감정보완 질문과 첨부 근거를 대응시키는 원본 보고서 묶음입니다.',['감정보완 대상과 입증취지','기존 감정의견 원문 요약','쟁점별 문제점과 기술 검증','구체적 보완 요청과 참고자료']],
  ['REF-02','항소에 대한 의견 보고서','TYPE-02',[],2,'항소이유 원문과 사실·계약·기술 기준을 대조하고 반박, 예상 재반박, 제출전략을 정리하는 원본 보고서 묶음입니다.',['항소심 핵심 결론','항소이유와 사실관계','쟁점별 검증과 반박','제출 전략과 체크리스트']],
  ['REF-03','설계변경·물가변동·간접비','TYPE-06',['TYPE-03'],2,'설계변경, 물가변동, 공기연장 직접비·간접비의 권리·인과·금액을 분리 계산하고 중복을 조정하는 원본 보고서 묶음입니다.',['계약관계와 변경 경과','설계변경 추가공사비','공기지연 직접·간접비','물가변동 계산과 결론']],
  ['REF-04','하자검토 보고서','TYPE-01',['TYPE-02'],1,'하자 주장, 판단기준, 현장·문서 근거, 보수방법, 수량과 금액을 항목별로 대조하는 원본 보고서 묶음입니다.',['검토 목적과 범위','하자 판단기준','항목별 주장·검토·판단','보수비와 종합의견']],
  ['REF-05','설계변경·물가변동 감정보고서','TYPE-06',['TYPE-02'],1,'감정 목적물, 조사현황, 설계변경 추가공사비와 물가변동 조정액을 공종별로 검증하는 원본 감정보고서 묶음입니다.',['감정 개요와 기준','설계변경 추가공사비','물가변동 계약금액 조정','산출근거와 종합의견']],
  ['REF-06','공사비 적정성 검토 보고서','TYPE-04',['TYPE-02','TYPE-06'],14,'정비사업과 일반 공사의 제출 총액·공종·수량·단가·간접비를 대사하고 협상 의견을 제시하는 원본 보고서 묶음입니다.',['사업·공사 개요','제출자료 정합성','공종별 수량·단가 검토','간접비·총액·협상 의견']],
  ['REF-07','하자조사 보고서','TYPE-01',[],2,'현장 위치·사진·도면, 하자현상·기준·원인, 보수방법·수량·보수비를 같은 ID로 연결하는 원본 보고서 묶음입니다.',['조사 개요와 방법','위치별 하자 조사','보수방법과 수량','보수비와 결론']],
  ['REF-08','돌관공사비 보고서','TYPE-03',[],2,'공기단축 지시, 기준·변경 일정, 단축일수, 추가 인력·장비와 실제원가를 검증하는 원본 보고서 묶음입니다.',['공기단축 지시와 일정','추가자원·생산성','돌관비 산정','인과관계와 결론']],
  ['REF-09','기시공·미시공 검토 보고서','TYPE-01',['TYPE-03'],2,'현장상태, 계약·실측수량, 기시공·미시공·잔여·재시공 범위와 기성금액을 검증하는 원본 보고서 묶음입니다.',['현장조사 방법','기시공·미시공 현황','수량과 기성률','공사비 검증과 증거목록']]
];

function agentCode(title) {
  if (/결론|요약|권고|부록|증거|제출문/u.test(title)) return 'AGENT-06';
  if (/금액|수량|단가|계산|비용|공사비|물가|산정/u.test(title)) return 'AGENT-04';
  if (/현장|조사|사진|도면/u.test(title)) return 'AGENT-03';
  if (/분석|쟁점|책임|인과|반박|협상|전략|감정/u.test(title)) return 'AGENT-05';
  if (/계약|기준|자료|범위/u.test(title)) return 'AGENT-02';
  return 'AGENT-01';
}

function typeSourceCodes(type) {
  return [...new Set(type.defaultOutputProfiles.map((id) => profileToSource[id]).filter(Boolean))];
}

function typeTarget(type) {
  return [
    `역할: ${type.role}`,
    `선택 신호: ${type.selectionSignals.join(' · ')}`,
    `제외 조건: ${type.excludeWhen.join(' · ')}`,
    `표준 절차: ${type.process.join(' → ')}`,
    `기본 출력 프로필: ${type.defaultOutputProfiles.join(', ')}`,
    `권장 모듈: ${type.recommendedModules.length ? type.recommendedModules.join(', ') : '없음'}`
  ].join('\n');
}

function typeToc(type) {
  return type.chapters.map((chapter) => {
    const state = chapter.required ? '필수' : `조건부 · ${chapter.activationRule}`;
    return `${chapter.order}. ${chapter.title} [${state}]\n   목적: ${chapter.purpose}`;
  }).join('\n');
}

function stage1Prompt(type) {
  const routing = config.classificationModel.routingQuestions.map((row) => `${row.order}) ${row.typeId}: ${row.question}`).join('\n');
  const modules = config.modules.filter((row) => row.compatibleTypeIds.includes(type.id)).map((row) => `${row.id} ${row.name}: ${row.instruction}`).join('\n');
  const profiles = config.outputProfiles.filter((row) => [...row.primaryTypeIds, ...row.secondaryTypeIds].includes(type.id)).map((row) => `${row.id} ${row.name}: ${row.structureRule}`).join('\n');
  return [
    `[분류 규칙] 주유형 정확히 1개 + 쟁점 모듈 0개 이상 + 출력 프로필 정확히 1개를 결정한다. 라우팅 우선순위는 ${config.classificationModel.routingPriority.join(' > ')}이다.`,
    routing,
    `[현재 승인 주유형] ${type.id} (${typeCode(type.id)}) ${type.name}. 다른 주유형으로 바꾸지 말고, 현재 사건 주제에서 필요한 모듈과 출력 프로필을 판단한다.`,
    `[유형 역할] ${type.role}`,
    `[유형 지침] ${type.typeInstruction}`,
    `[사용 가능 모듈]\n${modules || '없음'}`,
    `[사용 가능 출력 프로필]\n${profiles}`,
    `[목차 작성 규칙] 승인된 10개 챕터를 정확히 한 번씩 유지한다. 조건부 챕터는 활성 조건을 충족하지 않으면 삭제하지 말고 planningNote에 NOT_APPLICABLE과 근거를 기록한다. 각 planningNote에는 선택 모듈·출력 프로필, 사용할 자료 ID, 확인 필요 사항, 예상 산출물을 구체적으로 기록한다. 승인 자료에 없는 사실·수치·법령·판례는 만들지 않는다.`
  ].join('\n\n');
}

function stage2Prompt(type) {
  const policy = config.globalWritingPolicy;
  const modules = config.modules.filter((row) => row.compatibleTypeIds.includes(type.id)).map((row) => `${row.id} ${row.name}: ${row.instruction}`).join('\n');
  const profiles = config.outputProfiles.filter((row) => [...row.primaryTypeIds, ...row.secondaryTypeIds].includes(type.id)).map((row) => `${row.id} ${row.name}: 필수 모듈 ${row.requiredModules.join(', ') || '없음'}; ${row.structureRule}`).join('\n');
  return [
    `[문체] ${policy.tone}`,
    `[사실 분리] ${policy.factSeparation.join(' / ')}`,
    `[자료 부족 표지] ${policy.missingDataMarkers.join(' / ')}`,
    `[판단 상태] ${policy.decisionStatuses.join(' / ')}`,
    `[인용 형식] ${policy.citationFormats.join(' / ')}`,
    `[수치 규칙]\n- ${policy.numericRules.join('\n- ')}`,
    `[금지]\n- ${policy.prohibited.join('\n- ')}`,
    `[현재 유형] ${type.id} (${typeCode(type.id)}) ${type.name}\n${type.typeInstruction}`,
    `[호환 모듈]\n${modules || '없음'}`,
    `[출력 프로필]\n${profiles}`,
    `[판례 안전 규칙] 판례는 사용자가 이 챕터에서 공식 API 원문으로 선택·보존한 1~3건만 법리 근거로 사용한다. 사건번호·법원·선고일을 그대로 유지하고, 판례가 현재 사건의 사실관계나 귀책을 자동 입증한다고 단정하지 않는다. 판례의 유사점과 차이점을 함께 쓰며 사람이 원문 취지를 검수하기 전에는 확정 결론으로 취급하지 않는다.`
  ].join('\n\n');
}

function chapterRole(type, chapter) {
  return `${type.name} 보고서에서 '${chapter.title}' 챕터를 책임지는 전문 작성자입니다. ${chapter.purpose} 확인된 사건 자료와 승인된 앞 챕터만 사용하고, 근거 범위를 넘는 결론은 작성하지 않습니다.`;
}

function chapterInstruction(type, chapter) {
  const conditional = chapter.required ? '필수 챕터입니다.' : `조건부 챕터입니다. 활성 조건은 ${chapter.activationRule}입니다. 조건이 충족되지 않으면 내용을 지어내지 말고 NOT_APPLICABLE과 판단 근거만 기록하십시오.`;
  return [
    conditional,
    `목적: ${chapter.purpose}`,
    `필수 입력: ${chapter.requiredInputs.join(' · ')}`,
    `작성 지시: ${chapter.instruction}`,
    `필수 출력: ${chapter.requiredOutputs.join(' · ')}`,
    `검증: ${chapter.validationChecks.join(' · ')}`,
    `근거 규칙: 중요 사실·수치·판단에는 자료 ID와 위치를 붙이고, 자료가 없으면 ${config.globalWritingPolicy.missingDataMarkers.join(' 또는 ')}로 표시하십시오. 당사자 주장과 확인 사실, 분석, 결론을 분리하고 세부 챕터에 없는 결론을 새로 만들지 마십시오.`
  ].join('\n');
}

const typeRows = config.claimTypes.map((type) => [
  typeCode(type.id), type.name, typeTarget(type), typeToc(type), stage1Prompt(type), stage2Prompt(type),
  sourceFile(type.id), config.id ?? type.id, jsonText(typeSourceCodes(type))
]);

const chapterRows = config.claimTypes.flatMap((type) => type.chapters.map((chapter) => [
  typeCode(type.id), chapterCode(chapter.order), chapter.title, agentCode(chapter.title), chapterRole(type, chapter),
  chapterInstruction(type, chapter), chapter.order, jsonText(typeSourceCodes(type)),
  `${config.packageName} ${config.schemaVersion}의 ${type.id}/${chapter.id} 분석 결과. 보고서 원본 ZIP SHA-256 ${reportZipSha}.`
]));

const typeValues = typeRows.map((row) => `(${row.slice(0, 8).map(sqlText).join(',')},${row[8]})`).join(',\n');
const chapterValues = chapterRows.map((row) => `(${row.slice(0, 7).map((value, index) => index === 6 ? String(value) : sqlText(value)).join(',')},${row[7]},${sqlText(row[8])})`).join(',\n');
const compactConfig = JSON.stringify(config);
const packageId = `${config.packageId}-v${config.schemaVersion}`;
const categoryValues = categorySeeds.map(([code,name,primary,secondary,count,summary,outline], index) =>
  `('TPL-CATEGORY-${String(index + 1).padStart(2, '0')}',${sqlText(code)},${sqlText(name)},${sqlText(primary)},${jsonText(secondary)},${count},${sqlText(summary)},${jsonText(outline)})`
).join(',\n');

const sql = `-- CF84: activate the user-supplied claim report guideline package after
-- validating 58 source files (32 report originals, 25 proposal originals and
-- one process workbook). Existing prompts and histories are preserved.

CREATE TABLE IF NOT EXISTS preview_report_guideline_packages (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  package_name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  source_zip_sha256 TEXT NOT NULL,
  report_template_zip_sha256 TEXT NOT NULL,
  proposal_template_zip_sha256 TEXT NOT NULL,
  config_sha256 TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  installed_by TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  CHECK (organization_id='concost'),
  CHECK (length(source_zip_sha256)=64 AND lower(source_zip_sha256) NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(report_template_zip_sha256)=64 AND lower(report_template_zip_sha256) NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(proposal_template_zip_sha256)=64 AND lower(proposal_template_zip_sha256) NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(config_sha256)=64 AND lower(config_sha256) NOT GLOB '*[^0-9a-f]*'),
  CHECK (json_valid(config_json) AND json_extract(config_json,'$.schemaVersion')=schema_version),
  CHECK (status IN ('ACTIVE','SUPERSEDED')),
  FOREIGN KEY (installed_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_guideline_active (
  organization_id TEXT PRIMARY KEY NOT NULL,
  package_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  CHECK (organization_id='concost'),
  FOREIGN KEY (package_id) REFERENCES preview_report_guideline_packages(id)
);

CREATE TRIGGER IF NOT EXISTS preview_report_guideline_package_update_guard
BEFORE UPDATE ON preview_report_guideline_packages
BEGIN SELECT RAISE(ABORT,'report guideline packages are immutable'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_guideline_package_delete_guard
BEFORE DELETE ON preview_report_guideline_packages
BEGIN SELECT RAISE(ABORT,'report guideline packages cannot be deleted'); END;

INSERT OR IGNORE INTO preview_report_guideline_packages
  (id,organization_id,package_name,schema_version,effective_from,source_zip_sha256,report_template_zip_sha256,proposal_template_zip_sha256,config_sha256,config_json,status,installed_by,installed_at)
SELECT ${sqlText(packageId)},'concost',${sqlText(config.packageName)},${sqlText(config.schemaVersion)},${sqlText(config.effectiveFrom)},
       lower(${sqlText(packageZipSha)}),lower(${sqlText(reportZipSha)}),lower(${sqlText(proposalZipSha)}),
       lower(${sqlText(configSha)}),json(${sqlText(compactConfig)}),'ACTIVE',u.id,CURRENT_TIMESTAMP
FROM preview_users u WHERE u.is_active=1 AND instr(u.roles_json,'"admin"')>0 ORDER BY u.id LIMIT 1;

INSERT INTO preview_report_guideline_active (organization_id,package_id,activated_at)
SELECT 'concost',${sqlText(packageId)},CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM preview_report_guideline_packages WHERE id=${sqlText(packageId)})
ON CONFLICT(organization_id) DO UPDATE SET package_id=excluded.package_id,activated_at=excluded.activated_at;

CREATE TABLE _cf84_category_seed (
  id TEXT PRIMARY KEY,category_code TEXT,display_name TEXT,primary_claim_type TEXT,secondary_claim_types_json TEXT,
  source_file_count INTEGER,analysis_summary TEXT,outline_json TEXT
);
INSERT INTO _cf84_category_seed VALUES
${categoryValues};

INSERT OR IGNORE INTO preview_report_template_categories
  (id,category_code,display_name,primary_claim_type,secondary_claim_types_json,source_file_count,analysis_summary,outline_json,version,updated_by,updated_at)
SELECT s.id,s.category_code,s.display_name,s.primary_claim_type,s.secondary_claim_types_json,s.source_file_count,s.analysis_summary,s.outline_json,1,u.id,CURRENT_TIMESTAMP
FROM _cf84_category_seed s CROSS JOIN (SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1) u;

DROP TRIGGER IF EXISTS preview_report_prompt_admin_update;
DROP TRIGGER IF EXISTS preview_report_type_guideline_admin_update;

CREATE TABLE _cf84_type_seed (
  claim_type TEXT PRIMARY KEY,type_name TEXT,target_work TEXT,toc_blueprint TEXT,stage1_prompt TEXT,stage2_prompt TEXT,
  source_file_name TEXT,source_profile_id TEXT,source_codes_json TEXT
);
INSERT INTO _cf84_type_seed VALUES
${typeValues};

INSERT OR IGNORE INTO preview_report_prompt_sets
  (id,organization_id,claim_type,name,system_prompt,status,version,updated_by,updated_at)
SELECT 'PROMPT-TYPE-'||substr(s.claim_type,6,2),'concost',s.claim_type,s.type_name,${sqlText(systemPrompt)},'ACTIVE',1,u.id,CURRENT_TIMESTAMP
FROM _cf84_type_seed s CROSS JOIN (SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1) u;

CREATE TABLE _cf84_chapter_seed (
  claim_type TEXT,chapter_code TEXT,title TEXT,agent_code TEXT,role_prompt TEXT,instruction_prompt TEXT,
  ordinal INTEGER,source_codes_json TEXT,analysis_note TEXT,PRIMARY KEY(claim_type,chapter_code)
);
INSERT INTO _cf84_chapter_seed VALUES
${chapterValues};

UPDATE preview_report_type_guidelines
SET type_name=(SELECT s.type_name FROM _cf84_type_seed s WHERE s.claim_type=preview_report_type_guidelines.claim_type),
    target_work=(SELECT s.target_work FROM _cf84_type_seed s WHERE s.claim_type=preview_report_type_guidelines.claim_type),
    toc_blueprint=(SELECT s.toc_blueprint FROM _cf84_type_seed s WHERE s.claim_type=preview_report_type_guidelines.claim_type),
    stage1_prompt=(SELECT s.stage1_prompt FROM _cf84_type_seed s WHERE s.claim_type=preview_report_type_guidelines.claim_type),
    stage2_prompt=(SELECT s.stage2_prompt FROM _cf84_type_seed s WHERE s.claim_type=preview_report_type_guidelines.claim_type),
    source_file_name=(SELECT s.source_file_name FROM _cf84_type_seed s WHERE s.claim_type=preview_report_type_guidelines.claim_type),
    source_sha256=lower(${sqlText(packageZipSha)}),status='ACTIVE',version=version+1,
    updated_by=(SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+84 seconds')
WHERE organization_id='concost' AND claim_type IN (SELECT claim_type FROM _cf84_type_seed);

INSERT OR IGNORE INTO preview_report_type_guidelines
  (organization_id,claim_type,type_name,target_work,toc_blueprint,stage1_prompt,stage2_prompt,source_file_name,source_sha256,status,version,updated_by,updated_at)
SELECT 'concost',s.claim_type,s.type_name,s.target_work,s.toc_blueprint,s.stage1_prompt,s.stage2_prompt,s.source_file_name,
       lower(${sqlText(packageZipSha)}),'ACTIVE',1,u.id,strftime('%Y-%m-%dT%H:%M:%fZ','now','+84 seconds')
FROM _cf84_type_seed s CROSS JOIN (SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1) u;

INSERT OR IGNORE INTO preview_report_type_guideline_history
  (id,organization_id,claim_type,version,target_work,toc_blueprint,stage1_prompt,stage2_prompt,changed_by,changed_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       organization_id,claim_type,version,target_work,toc_blueprint,stage1_prompt,stage2_prompt,updated_by,updated_at
FROM preview_report_type_guidelines WHERE organization_id='concost' AND claim_type IN (SELECT claim_type FROM _cf84_type_seed);

UPDATE preview_report_prompt_sets
SET name=(SELECT s.type_name FROM _cf84_type_seed s WHERE s.claim_type=preview_report_prompt_sets.claim_type),
    system_prompt=${sqlText(systemPrompt)},status='ACTIVE',version=version+1,
    updated_by=(SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+84 seconds')
WHERE organization_id='concost' AND claim_type IN (SELECT claim_type FROM _cf84_type_seed);

UPDATE preview_report_chapter_prompts
SET title=COALESCE((SELECT s.title FROM _cf84_chapter_seed s JOIN preview_report_prompt_sets ps ON ps.claim_type=s.claim_type WHERE ps.id=preview_report_chapter_prompts.prompt_set_id AND s.chapter_code=preview_report_chapter_prompts.chapter_code),title),
    agent_code=COALESCE((SELECT s.agent_code FROM _cf84_chapter_seed s JOIN preview_report_prompt_sets ps ON ps.claim_type=s.claim_type WHERE ps.id=preview_report_chapter_prompts.prompt_set_id AND s.chapter_code=preview_report_chapter_prompts.chapter_code),agent_code),
    role_prompt=COALESCE((SELECT s.role_prompt FROM _cf84_chapter_seed s JOIN preview_report_prompt_sets ps ON ps.claim_type=s.claim_type WHERE ps.id=preview_report_chapter_prompts.prompt_set_id AND s.chapter_code=preview_report_chapter_prompts.chapter_code),role_prompt),
    instruction_prompt=COALESCE((SELECT s.instruction_prompt FROM _cf84_chapter_seed s JOIN preview_report_prompt_sets ps ON ps.claim_type=s.claim_type WHERE ps.id=preview_report_chapter_prompts.prompt_set_id AND s.chapter_code=preview_report_chapter_prompts.chapter_code),instruction_prompt),
    status=CASE WHEN EXISTS (SELECT 1 FROM _cf84_chapter_seed s JOIN preview_report_prompt_sets ps ON ps.claim_type=s.claim_type WHERE ps.id=preview_report_chapter_prompts.prompt_set_id AND s.chapter_code=preview_report_chapter_prompts.chapter_code) THEN 'ACTIVE' ELSE 'ARCHIVED' END,
    version=version+1,updated_by=(SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+84 seconds')
WHERE prompt_set_id IN (SELECT id FROM preview_report_prompt_sets WHERE organization_id='concost' AND claim_type IN (SELECT claim_type FROM _cf84_type_seed));

INSERT OR IGNORE INTO preview_report_chapter_prompts
  (id,prompt_set_id,chapter_code,title,agent_code,role_prompt,instruction_prompt,ordinal,version,updated_by,updated_at,status)
SELECT 'PROMPT-'||s.claim_type||'-'||s.chapter_code,ps.id,s.chapter_code,s.title,s.agent_code,s.role_prompt,s.instruction_prompt,s.ordinal,1,u.id,
       strftime('%Y-%m-%dT%H:%M:%fZ','now','+84 seconds'),'ACTIVE'
FROM _cf84_chapter_seed s JOIN preview_report_prompt_sets ps ON ps.organization_id='concost' AND ps.claim_type=s.claim_type
CROSS JOIN (SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1) u;

INSERT OR IGNORE INTO preview_report_prompt_history
  (id,prompt_id,version,role_prompt,instruction_prompt,changed_by,changed_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       p.id,p.version,p.role_prompt,p.instruction_prompt,p.updated_by,p.updated_at
FROM preview_report_chapter_prompts p JOIN preview_report_prompt_sets ps ON ps.id=p.prompt_set_id
WHERE ps.organization_id='concost' AND ps.claim_type IN (SELECT claim_type FROM _cf84_type_seed);

INSERT OR REPLACE INTO preview_report_prompt_source_basis
  (prompt_id,source_category_codes_json,analysis_note,analysis_version,analyzed_at)
SELECT p.id,s.source_codes_json,s.analysis_note,2,CURRENT_TIMESTAMP
FROM _cf84_chapter_seed s JOIN preview_report_prompt_sets ps ON ps.organization_id='concost' AND ps.claim_type=s.claim_type
JOIN preview_report_chapter_prompts p ON p.prompt_set_id=ps.id AND p.chapter_code=s.chapter_code;

DROP TABLE _cf84_chapter_seed;
DROP TABLE _cf84_type_seed;
DROP TABLE _cf84_category_seed;

CREATE TRIGGER preview_report_prompt_admin_update
BEFORE UPDATE ON preview_report_chapter_prompts
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
) OR NEW.id<>OLD.id OR NEW.prompt_set_id<>OLD.prompt_set_id OR NEW.chapter_code<>OLD.chapter_code
  OR NEW.ordinal<>OLD.ordinal OR NEW.status<>OLD.status OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN SELECT RAISE(ABORT,'chapter prompts require active Admin and optimistic version'); END;

CREATE TRIGGER preview_report_type_guideline_admin_update
BEFORE UPDATE ON preview_report_type_guidelines
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
) OR NEW.organization_id<>OLD.organization_id OR NEW.claim_type<>OLD.claim_type
  OR NEW.type_name<>OLD.type_name OR NEW.source_file_name<>OLD.source_file_name OR NEW.source_sha256<>OLD.source_sha256
  OR NEW.status<>OLD.status OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN SELECT RAISE(ABORT,'report type guidelines require active Admin and optimistic version'); END;
`;

writeFileSync(outputPath, sql, 'utf8');
