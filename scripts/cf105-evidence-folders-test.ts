import assert from 'node:assert/strict';
import test from 'node:test';
import { groupEvidenceFiles } from '../apps/web/src/evidence/CaseEvidencePanel';

type File = Parameters<typeof groupEvidenceFiles>[0][number];
const file: File = { id: 'file-a', category: 'MEETING_MINUTES', originalName: '회의록.txt', mimeType: 'text/plain', byteSize: 12, sha256: 'a'.repeat(64), storageProvider: 'GOOGLE_DRIVE', uploadedBy: '동명이인', uploadedAt: '2026-09-03T00:00:00Z', downloadUrl: '/api/cases/evidence/file-a/download', driveUrl: null, folder: { key: 'folder-a', name: '같은 폴더명' } };

test('CF105 groups by opaque folder identity and retains archive-only and unknown folders', () => {
  const files: File[] = [file,
    { ...file, id: 'file-b', folder: { key: 'folder-b', name: '같은 폴더명' } },
    { ...file, id: 'file-old', isLatest: false, folder: { key: 'folder-old', name: '이전 날짜 폴더' } },
    { ...file, id: 'file-unknown', folder: undefined },
    { ...file, id: 'file-unknown-2', folder: undefined },
    { ...file, id: 'file-temp', storageProvider: 'D1_TEMPORARY', folder: undefined },
    { ...file, id: 'file-same-folder', folder: file.folder }
  ];
  const before = JSON.stringify(files);
  const groups = groupEvidenceFiles(files);
  assert.equal(groups.length, 6);
  assert.equal(groups.filter((group) => group.name === '같은 폴더명').length, 2);
  assert.deepEqual(groups[0].files.map((entry) => entry.id), ['file-a', 'file-same-folder']);
  assert.equal(groups.find((group) => group.key === 'folder-old')?.files[0].isLatest, false);
  assert.equal(groups.filter((group) => group.name === '폴더명 확인 불가').length, 2);
  assert.equal(groups.find((group) => group.key === 'temporary')?.name, '스튜디오 임시 보관');
  assert.equal(new Set(groups.flatMap((group) => group.files.map((entry) => entry.id))).size, files.length);
  assert.equal(JSON.stringify(files), before);
  assert.deepEqual(groupEvidenceFiles([]), []);
});
