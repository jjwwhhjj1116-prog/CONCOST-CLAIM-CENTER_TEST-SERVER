import { Button, Dialog } from '@claim-studio/ui';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiRequest } from '../api';
import { CATEGORY_HELP, CURRENT_TUTORIAL_VERSION, ROUTE_HELP, WORKSPACE_TUTORIAL_STEPS } from './workspace-help-content';

interface TutorialState {
  completedTutorialVersion: string | null;
  completedAt: string | null;
  completionAction: 'COMPLETED' | 'SKIPPED' | null;
  version: number;
  updatedAt: string | null;
}

interface TutorialTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\/+$/u, '') || '/';
  return normalize(left) === normalize(right);
}

export function WorkspaceHelpCenter({ category, routeId, previewMode, suspended = false, onNavigate }: {
  category: string;
  routeId?: string;
  previewMode: boolean;
  suspended?: boolean;
  onNavigate: (path: string) => void;
}): React.ReactElement {
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialState, setTutorialState] = useState<TutorialState>({ completedTutorialVersion: null, completedAt: null, completionAction: null, version: 0, updatedAt: null });
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(() => new Set());
  const [openedSteps, setOpenedSteps] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [targetRect, setTargetRect] = useState<TutorialTargetRect | null>(null);
  const [pointIndex, setPointIndex] = useState(0);
  const [coachCollapsed, setCoachCollapsed] = useState(false);
  const targetElementRef = useRef<HTMLElement | null>(null);
  const tutorialLoadedRef = useRef(false);
  const categoryHelp = CATEGORY_HELP[category] ?? CATEGORY_HELP.home;
  const routeHelp = routeId ? ROUTE_HELP[routeId] : undefined;
  const step = WORKSPACE_TUTORIAL_STEPS[tutorialStep] ?? WORKSPACE_TUTORIAL_STEPS[0];
  const progress = useMemo(() => Math.round(((tutorialStep + 1) / WORKSPACE_TUTORIAL_STEPS.length) * 100), [tutorialStep]);
  const currentScreenOpen = tutorialOpen && !suspended && openedSteps.has(tutorialStep) && samePath(window.location.pathname, step.path);

  useEffect(() => {
    if (!previewMode || suspended || tutorialLoadedRef.current) return;
    let active = true;
    void apiRequest<{ tutorial: TutorialState; currentTutorialVersion: string }>('/api/settings/tutorial')
      .then((result) => {
        if (!active) return;
        tutorialLoadedRef.current = true;
        setTutorialState(result.tutorial);
        if (result.tutorial.completedTutorialVersion !== CURRENT_TUTORIAL_VERSION) setTutorialOpen(true);
      })
      .catch(() => {
        if (active) tutorialLoadedRef.current = true;
        if (active && window.localStorage.getItem('claim-center-tutorial-fallback') !== CURRENT_TUTORIAL_VERSION) setTutorialOpen(true);
      });
    return () => { active = false; };
  }, [previewMode, suspended]);

  useEffect(() => {
    const clearTarget = () => {
      targetElementRef.current?.classList.remove('workspace-tutorial-focus-source');
      targetElementRef.current = null;
      setTargetRect(null);
    };
    if (!currentScreenOpen) { clearTarget(); return; }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const fallback = Array.from(document.querySelectorAll('#main-content h1, #main-content h2, #main-content h3, #main-content form, #main-content button, #main-content select, #main-content textarea'));
        const selector = step.targetSelectors[Math.min(pointIndex, step.targetSelectors.length - 1)];
        const explicit = selector ? document.querySelector(selector) : null;
        const explicitRect = explicit?.getBoundingClientRect();
        const element = explicit && explicitRect && explicitRect.width > 20 && explicitRect.height > 14
          ? explicit
          : fallback.find((candidate) => candidate.getBoundingClientRect().width > 20 && candidate.getBoundingClientRect().height > 14);
        if (!(element instanceof HTMLElement)) { clearTarget(); return; }
        if (targetElementRef.current !== element) {
          targetElementRef.current?.removeEventListener('click', confirmPoint, { capture: true });
          targetElementRef.current?.classList.remove('workspace-tutorial-focus-source');
          targetElementRef.current = element;
          element.classList.add('workspace-tutorial-focus-source');
          element.addEventListener('click', confirmPoint, { capture: true, once: true });
          element.scrollIntoView({ behavior: 'smooth', block: window.innerWidth <= 760 ? 'start' : 'center', inline: 'nearest' });
        }
        const rect = element.getBoundingClientRect();
        const left = Math.max(10, rect.left - 8);
        const top = Math.max(10, rect.top - 8);
        const right = Math.min(window.innerWidth - 10, rect.right + 8);
        const bottom = Math.min(window.innerHeight - 10, rect.bottom + 8);
        setTargetRect({ left, top, right, bottom, width: Math.max(36, right - left), height: Math.max(32, bottom - top) });
      });
    };
    const confirmPoint = () => {
      setNotice('');
      if (pointIndex < step.tasks.length - 1) setPointIndex((current) => current + 1);
      else {
        setVisitedSteps((current) => new Set(current).add(tutorialStep));
        setNotice('이 화면의 핵심 기능을 모두 확인했습니다. 다음 업무 단계로 이동할 수 있습니다.');
      }
    };
    measure();
    const main = document.getElementById('main-content');
    const observer = new MutationObserver(measure);
    if (main) observer.observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const delayed = window.setTimeout(measure, 450);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
      targetElementRef.current?.removeEventListener('click', confirmPoint, { capture: true });
      clearTarget();
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [currentScreenOpen, pointIndex, step.targetSelectors, step.tasks.length, tutorialStep]);

  const coachStyle = useMemo<CSSProperties>(() => {
    if (!currentScreenOpen || !targetRect || window.innerWidth <= 760) return {};
    const width = Math.min(540, window.innerWidth - 36);
    const gap = 22;
    const maxTop = Math.max(70, window.innerHeight - 610);
    const top = Math.min(Math.max(70, targetRect.top), maxTop);
    if (targetRect.right + gap + width < window.innerWidth) return { left: targetRect.right + gap, right: 'auto', top, bottom: 'auto' };
    if (targetRect.left - gap - width > 0) return { left: targetRect.left - gap - width, right: 'auto', top, bottom: 'auto' };
    return { left: '50%', right: 'auto', top: 'auto', bottom: 18, transform: 'translateX(-50%)' };
  }, [currentScreenOpen, targetRect]);

  const saveTutorialDecision = async (action: 'COMPLETED' | 'SKIPPED') => {
    if (saving) return;
    setSaving(true); setNotice('');
    try {
      const result = await apiRequest<{ tutorial: TutorialState }>('/api/settings/tutorial', {
        method: 'PUT', body: JSON.stringify({ tutorialVersion: CURRENT_TUTORIAL_VERSION, expectedVersion: tutorialState.version, action })
      });
      setTutorialState(result.tutorial);
      window.localStorage.setItem('claim-center-tutorial-fallback', CURRENT_TUTORIAL_VERSION);
      setTutorialOpen(false); setTutorialStep(0); setPointIndex(0); setVisitedSteps(new Set()); setOpenedSteps(new Set());
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        const latest = await apiRequest<{ tutorial: TutorialState }>('/api/settings/tutorial').catch(() => null);
        if (latest?.tutorial.completedTutorialVersion === CURRENT_TUTORIAL_VERSION) {
          setTutorialState(latest.tutorial); setTutorialOpen(false); setTutorialStep(0); setPointIndex(0); setVisitedSteps(new Set()); setOpenedSteps(new Set()); return;
        }
      }
      setNotice('완료 상태를 저장하지 못했습니다. 네트워크를 확인한 뒤 다시 눌러 주세요. 안내 내용은 사라지지 않습니다.');
    } finally { setSaving(false); }
  };

  const reopenTutorial = () => {
    setHelpOpen(false); setTutorialStep(0); setPointIndex(0); setVisitedSteps(new Set()); setOpenedSteps(new Set()); setNotice(''); setCoachCollapsed(false); setTutorialOpen(true);
  };

  const visitTutorialStep = () => {
    setPointIndex(0);
    setOpenedSteps((current) => new Set(current).add(tutorialStep));
    setNotice('강조된 첫 번째 기능을 직접 눌러 보세요. 누르면 다음 안내 지점으로 자동 이동합니다.');
    setCoachCollapsed(false);
    onNavigate(step.path);
  };

  const moveTutorialStep = (next: number) => {
    setTutorialStep(next);
    setPointIndex(0);
    setCoachCollapsed(false);
    setTargetRect(null);
    setNotice('');
  };

  return <>
    <button type="button" className="theme-toggle workspace-help-trigger" aria-label="현재 화면 도움말 열기" onClick={() => setHelpOpen(true)}>
      <span aria-hidden="true">?</span><strong>도움말</strong>
    </button>
    {tutorialOpen && !suspended && createPortal(<div className={`workspace-tutorial-layer${currentScreenOpen ? ' is-guiding' : ''}`}>
      {currentScreenOpen && targetRect && <>
        <div className="workspace-tutorial-shade is-top" style={{ height: targetRect.top }} onClick={() => setNotice('주황색으로 확대된 기능을 직접 눌러야 다음 포인트로 넘어갑니다.')} />
        <div className="workspace-tutorial-shade is-left" style={{ top: targetRect.top, width: targetRect.left, height: targetRect.height }} onClick={() => setNotice('주황색으로 확대된 기능을 직접 눌러야 다음 포인트로 넘어갑니다.')} />
        <div className="workspace-tutorial-shade is-right" style={{ top: targetRect.top, left: targetRect.right, right: 0, height: targetRect.height }} onClick={() => setNotice('주황색으로 확대된 기능을 직접 눌러야 다음 포인트로 넘어갑니다.')} />
        <div className="workspace-tutorial-shade is-bottom" style={{ top: targetRect.bottom, bottom: 0 }} onClick={() => setNotice('주황색으로 확대된 기능을 직접 눌러야 다음 포인트로 넘어갑니다.')} />
        <div className="workspace-tutorial-target" aria-hidden="true" style={{ left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height }}><span>{pointIndex + 1}</span><b>여기를 직접 눌러보세요</b></div>
      </>}
      <aside className={`workspace-tutorial-coach${coachCollapsed ? ' is-collapsed' : ''}${currentScreenOpen ? ' is-live' : ' is-launcher'}`} style={coachStyle} role="complementary" aria-label="처음 사용하는 분을 위한 클레임센터 업무 순서" data-step={tutorialStep + 1}>
        <div className="workspace-tutorial-coach__bar"><span>{currentScreenOpen ? '실제 화면 안내 중' : '처음 사용 가이드'}</span><div><button type="button" onClick={() => setCoachCollapsed((value) => !value)}>{coachCollapsed ? '안내 펼치기' : '안내 접기'}</button><button type="button" aria-label="튜토리얼 닫기" onClick={() => setTutorialOpen(false)}>×</button></div></div>
        {!coachCollapsed && <div className="workspace-tutorial">
        <header><span>{step.eyebrow}</span><strong>{tutorialStep + 1} / {WORKSPACE_TUTORIAL_STEPS.length}</strong></header>
        <div className="workspace-tutorial__progress" aria-label={`튜토리얼 ${progress}% 완료`}><i style={{ width: `${progress}%` }} /></div>
        <section><h3>{step.title}</h3><p>{step.explanation}</p><ol>{step.tasks.map((task, index) => <li key={task} className={visitedSteps.has(tutorialStep) || index < pointIndex ? 'is-complete' : currentScreenOpen && index === pointIndex ? 'is-on-screen' : ''}><span>{visitedSteps.has(tutorialStep) || index < pointIndex ? '✓' : index + 1}</span>{task}</li>)}</ol></section>
        <aside><strong>이 단계의 완료 기준</strong><p>{step.completion}</p></aside>
        <div className={`workspace-tutorial__visit ${visitedSteps.has(tutorialStep) ? 'is-visited' : ''}`}>
          <div><strong>{currentScreenOpen ? visitedSteps.has(tutorialStep) ? '이 화면의 핵심 기능 확인 완료' : `${pointIndex + 1}번 기능을 직접 눌러 보세요` : '게임식 화면 안내를 시작합니다'}</strong><span>{currentScreenOpen ? '화면은 흐려지지 않고 지금 눌러야 할 한 곳만 밝게 확대됩니다. 실제 기능을 누르면 다음 포인트가 열립니다.' : '버튼을 누르면 해당 업무 화면으로 이동하고 첫 번째 기능이 자동으로 확대됩니다.'}</span></div>
          {!currentScreenOpen && <Button variant="secondary" onClick={visitTutorialStep}>{visitedSteps.has(tutorialStep) ? '이 단계 다시 체험하기' : `${step.pathLabel} · 안내 시작`}</Button>}
        </div>
        {notice && <p className="error-box" role="alert">{notice}</p>}
        <footer>
          <Button variant="secondary" disabled={tutorialStep === 0 || saving} onClick={() => moveTutorialStep(Math.max(0, tutorialStep - 1))}>← 이전 설명</Button>
          <Button variant="secondary" disabled={saving} onClick={() => void saveTutorialDecision('SKIPPED')}>가이드 건너뛰기</Button>
          {tutorialStep < WORKSPACE_TUTORIAL_STEPS.length - 1
            ? <Button disabled={!visitedSteps.has(tutorialStep)} onClick={() => moveTutorialStep(Math.min(WORKSPACE_TUTORIAL_STEPS.length - 1, tutorialStep + 1))}>다음 설명 →</Button>
            : <Button disabled={saving || !visitedSteps.has(tutorialStep)} onClick={() => void saveTutorialDecision('COMPLETED')}>{saving ? '완료 저장 중…' : '튜토리얼 완료'}</Button>}
        </footer>
        <small>실제 저장·삭제 버튼은 튜토리얼 대상에서 제외합니다. 건너뛰기는 이 계정에 1회 저장되며, 상단 도움말에서 언제든 다시 체험할 수 있습니다.</small>
        </div>}
      </aside>
    </div>, document.body)}
    <Dialog isOpen={helpOpen && !suspended} title={`도움말 · ${categoryHelp.title}`} onClose={() => setHelpOpen(false)} hideDefaultAction size="wide">
      <div className="workspace-help-center">
        <header><span>CURRENT CATEGORY GUIDE</span><h3>{categoryHelp.title}</h3><p>{categoryHelp.purpose}</p></header>
        <div className="workspace-help-center__grid">
          <section><strong>먼저 준비할 것</strong><ul>{categoryHelp.inputs.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section><strong>이 화면에서 하는 일</strong><ol>{categoryHelp.actions.map((item) => <li key={item}>{item}</li>)}</ol></section>
          <section><strong>완료되면 남는 것</strong><ul>{categoryHelp.outputs.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="is-caution"><strong>실수 방지</strong><ul>{categoryHelp.cautions.map((item) => <li key={item}>{item}</li>)}</ul></section>
        </div>
        {routeHelp && <section className="workspace-help-center__route"><span>현재 화면</span><h3>{routeHelp.title}</h3><ol>{routeHelp.steps.map((item) => <li key={item}>{item}</li>)}</ol><p><strong>다음 권장 화면</strong> {routeHelp.next}</p></section>}
        <footer><Button variant="secondary" onClick={reopenTutorial}>전체 튜토리얼 다시 보기</Button><Button onClick={() => setHelpOpen(false)}>현재 화면에서 계속하기</Button></footer>
      </div>
    </Dialog>
  </>;
}
