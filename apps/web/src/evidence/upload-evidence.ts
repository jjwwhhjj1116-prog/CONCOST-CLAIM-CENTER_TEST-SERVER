interface UploadConflict {
  status: 'DUPLICATE_EXACT' | 'VERSION_CONFLICT_CONFIRMATION'; reviewId?: string; nextVersion?: number;
  existing_file: { name: string; uploader: string; created_at: string };
  analysis?: { change_summary: string[] };
  file?: { id: string; originalName: string; storageProvider: string; downloadUrl: string; driveUrl: null };
}
type Choice = 'REPLACE_AS_LATEST' | 'KEEP_AS_NEW_SEPARATE' | 'SEPARATE';
const COMPARISON_UNAVAILABLE_CODES = new Set([
  'PAID_NO_TRAINING_REQUIRED', 'ORGANIZATION_GEMINI_NOT_CONFIGURED', 'VERSION_ANALYSIS_UNAVAILABLE',
  'VERSION_TEXT_EXTRACTION_FAILED', 'VERSION_COMPARE_TOO_LARGE', 'INVALID_VERSION_ANALYSIS'
]);

/** A native modal also works for uploads launched from report/meeting tools outside the library. */
function confirmVersion(conflict: UploadConflict | { status: 'COMPARISON_UNAVAILABLE'; error?: string }): Promise<Choice | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'evidence-version-dialog';
    const title = document.createElement('h2'); title.id = `evidence-review-${crypto.randomUUID()}`;
    title.textContent = conflict.status === 'COMPARISON_UNAVAILABLE' ? 'AI 비교 없이 별도 자료로 저장할까요?' : conflict.status === 'DUPLICATE_EXACT' ? '동일한 내용의 파일이 이미 등록되어 있습니다' : '이 문서를 최신본으로 바꿀까요?';
    dialog.setAttribute('aria-labelledby', title.id); dialog.append(title);
    if (conflict.status === 'COMPARISON_UNAVAILABLE') {
      const reason = document.createElement('p'); reason.textContent = conflict.error || '현재 문서 AI 비교를 사용할 수 없습니다.'; dialog.append(reason);
    } else {
    const file = document.createElement('p'); file.className = 'evidence-conflict-file';
    const name = document.createElement('strong'); name.textContent = conflict.existing_file.name;
    const author = document.createElement('span'); author.textContent = `${conflict.existing_file.uploader} · ${new Date(conflict.existing_file.created_at).toLocaleString('ko-KR')}`;
    file.append(name, author); dialog.append(file);
    if (conflict.analysis) {
      const list = document.createElement('ul');
      for (const text of conflict.analysis.change_summary) { const item = document.createElement('li'); item.textContent = text; list.append(item); }
      dialog.append(list);
    }
    }
    const note = document.createElement('p'); note.textContent = conflict.status === 'COMPARISON_UNAVAILABLE' ? 'AI 비교 없이 기존 파일은 그대로 두고 별도 자료로 저장하여 계속할까요? 기존 최신본은 대체하지 않으며, 이번 파일은 독립된 새 자료로 보관합니다.' : conflict.status === 'DUPLICATE_EXACT' ? 'SHA-256이 100% 일치하여 새 파일을 저장하지 않았습니다.' : '최신본으로 바꾸어도 이전 파일은 보존됩니다. 별도 저장을 선택하면 두 문서가 독립적으로 남습니다.'; dialog.append(note);
    const actions = document.createElement('div'); actions.className = 'evidence-version-actions'; dialog.append(actions);
    let finished = false;
    const close = (choice: Choice | null = null) => {
      if (finished) return; finished = true; window.removeEventListener('popstate', cancel);
      dialog.close(); dialog.remove(); resolve(choice);
    };
    const cancel = () => close();
    const button = (label: string, choice: Choice | null, primary = false) => { const control = document.createElement('button'); control.type = 'button'; control.className = primary ? 'is-primary' : ''; control.textContent = label; control.addEventListener('click', () => close(choice)); actions.append(control); };
    if (conflict.status === 'COMPARISON_UNAVAILABLE') { button('AI 비교 없이 별도 저장', 'SEPARATE', true); button('취소', null); }
    else if (conflict.status === 'VERSION_CONFLICT_CONFIRMATION') { button(`최신본으로 대체 · v${conflict.nextVersion}`, 'REPLACE_AS_LATEST', true); button('별도 신규 파일로 저장', 'KEEP_AS_NEW_SEPARATE'); button('취소', null); }
    else button('확인', null, true);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    window.addEventListener('popstate', cancel); document.body.append(dialog); dialog.showModal();
  });
}

export async function fetchEvidenceUpload(url: string, init: RequestInit, options: { isCurrent?: () => boolean; reuseExact?: boolean } = {}): Promise<Response> {
  const isCurrent = options.isCurrent ?? (() => true);
  if (!/^\/api\/cases\/[0-9a-f-]+\/evidence$/iu.test(url) || !(init.body instanceof FormData)) throw new Error('프로젝트 업로드 요청이 올바르지 않습니다.');
  while (isCurrent()) {
    const response = await fetch(url, init);
    if (!isCurrent() || response.ok) return response;
    const payload = await response.clone().json().catch(() => null) as (Partial<UploadConflict> & { code?: string; error?: string }) | null;
    if (!payload) return response;
    if (COMPARISON_UNAVAILABLE_CODES.has(payload.code ?? '') && init.body.get('versionMode') !== 'SEPARATE') {
      const choice = await confirmVersion({ status: 'COMPARISON_UNAVAILABLE', error: payload.error });
      if (!choice || !isCurrent()) return Response.json({ error: '파일 저장을 취소했습니다.', code: 'UPLOAD_CANCELLED' }, { status: 409 });
      init.body.delete('reviewId'); init.body.delete('versionChoice'); init.body.set('versionMode', 'SEPARATE');
      continue;
    }
    if (response.status !== 409 || !['DUPLICATE_EXACT', 'VERSION_CONFLICT_CONFIRMATION'].includes(payload.status ?? '')) return response;
    const choice = await confirmVersion(payload as UploadConflict);
    if (payload.status === 'DUPLICATE_EXACT') {
      // Import tools may continue working with an already stored original; the API still returns 409 and writes nothing.
      return options.reuseExact && payload.file && isCurrent() ? Response.json({ file: payload.file, reusedExisting: true }) : response;
    }
    if (!choice || !isCurrent()) return Response.json({ error: '파일 저장을 취소했습니다.', code: 'UPLOAD_CANCELLED' }, { status: 409 });
    init.body.set('reviewId', payload.reviewId!); init.body.set('versionChoice', choice);
  }
  return Response.json({ error: '프로젝트가 변경되어 파일 저장을 중단했습니다.', code: 'UPLOAD_CANCELLED' }, { status: 409 });
}
