import { Button, Card } from '@claim-studio/ui';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import './PreviewLawApiSettings.css';

interface LawApiSettings {
  configured: boolean;
  storage: 'ENCRYPTED_D1' | 'CLOUDFLARE_SECRET' | 'NONE';
  version: number;
  updatedAt: string | null;
  masterKeyReady: boolean;
}

export function PreviewLawApiSettings(): React.ReactElement {
  const [settings, setSettings] = useState<LawApiSettings | null>(null);
  const [oc, setOc] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | ''>('load');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const load = async () => {
    if (pending.current) return;
    pending.current = true; setBusy('load'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: LawApiSettings }>('/api/settings/law-api');
      if (mounted.current) setSettings(result.settings);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '설정을 불러오지 못했습니다. 다시 불러와 주세요.');
    } finally { pending.current = false; if (mounted.current) setBusy(''); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);

  const submit = async (action: 'save' | 'test') => {
    if (!settings || pending.current || (action === 'test' && oc.trim())) return;
    if (action === 'save' && !/^[A-Za-z0-9._@+-]{2,120}$/u.test(oc.trim())) {
      setError('OC 인증값은 공백 없이 영문·숫자와 . _ @ + - 문자로 2~120자 입력해 주세요.'); return;
    }
    pending.current = true; setBusy(action); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: LawApiSettings; checkedAt?: string; count?: number }>(`/api/settings/law-api${action === 'test' ? '/test' : ''}`, {
        method: action === 'save' ? 'PUT' : 'POST', timeoutMs: 30_000,
        body: JSON.stringify({ ...(action === 'save' ? { oc: oc.trim() } : {}), expectedVersion: settings.version })
      });
      if (!mounted.current) return;
      setSettings(result.settings);
      if (action === 'save') setOc('');
      setNotice(action === 'save'
        ? 'OC 인증값을 암호화 저장했습니다. 아래 연결 확인으로 판례 API 승인 상태를 확인하세요.'
        : `연결 정상 · 공식 판례 응답 ${result.count ?? 0}건 확인. 보고서의 판례 검색·원문 조회에 사용할 수 있습니다.`);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof ApiError && reason.status === 409
        ? '다른 화면에서 설정이 변경되었습니다. 입력값은 유지했습니다. 설정 다시 불러오기 후 저장해 주세요.'
        : reason instanceof Error ? reason.message : '처리하지 못했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.');
    } finally { pending.current = false; if (mounted.current) setBusy(''); }
  };

  return <Card title="국가법령정보 · 판례 API 연결" className="law-api-settings">
    <p>국가법령정보 공동활용에서 발급받은 <strong>API 인증값(OC)</strong>을 입력하세요. Google 로그인이나 Claude·Gemini API 키와는 별도입니다.</p>
    <p className="law-api-settings-status">{busy === 'load' ? '저장 상태 확인 중…' : settings?.configured
      ? `${settings.storage === 'ENCRYPTED_D1' ? 'OC 암호화 저장됨' : '서버 인증값 설정됨'} · v${settings.version}`
      : 'OC 미설정 · 발급받은 인증값을 저장해 주세요.'}</p>
    <form onSubmit={(event) => { event.preventDefault(); void submit('save'); }}>
      <label htmlFor="law-api-oc">API 인증값(OC)</label>
      <input id="law-api-oc" type="password" autoComplete="new-password" spellCheck={false} maxLength={120}
        value={oc} disabled={Boolean(busy) || !settings?.masterKeyReady} aria-describedby="law-api-oc-help"
        placeholder={settings?.configured ? '인증값을 교체할 때만 새 OC 입력' : '발급받은 OC 인증값 입력'}
        onChange={(event) => { setOc(event.target.value); setError(''); setNotice(''); }} />
      <small id="law-api-oc-help">저장된 인증값은 다시 표시하지 않습니다. 테스트·가오픈 서버는 각각 저장해야 합니다.</small>
      <div className="action-row">
        <Button type="submit" disabled={Boolean(busy) || !settings?.masterKeyReady || !oc.trim()}>{busy === 'save' ? '저장 중…' : 'OC 저장'}</Button>
        <Button type="button" variant="secondary" disabled={Boolean(busy) || !settings?.configured || Boolean(oc.trim())} onClick={() => void submit('test')}>{busy === 'test' ? '공식 판례 연결 확인 중…' : '저장된 인증값 연결 확인'}</Button>
        <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void load()}>설정 다시 불러오기</Button>
      </div>
      {oc.trim() && <p>입력 중인 값은 아직 적용되지 않았습니다. 먼저 OC 저장을 눌러 주세요.</p>}
      {settings && !settings.masterKeyReady && <p role="alert">서버 암호화 설정이 준비되지 않아 저장할 수 없습니다. 기존 키 설정은 변경하지 마세요.</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}
      {error && <p className="error-box" role="alert">{error}</p>}
    </form>
    <details className="credential-issue-guide"><summary>OC 발급·연결 안내</summary>
      <ol><li>국가법령정보 공동활용 사이트에서 판례 API 이용을 신청합니다.</li><li>승인받은 API 인증값(OC)을 이 화면에 저장합니다.</li><li>연결 확인에 성공하면 보고서 작성의 판례 검색에서 사용합니다.</li></ol>
      <p>아직 승인받지 않았다면 공식 사이트의 공개 판례 검색은 사용할 수 있습니다. 앱 내부 검색·원문 가져오기는 API 승인 후 이용 가능합니다.</p>
      <a href="https://open.law.go.kr" target="_blank" rel="noreferrer">국가법령정보 공동활용 · 신청 안내 ↗</a>
    </details>
  </Card>;
}
