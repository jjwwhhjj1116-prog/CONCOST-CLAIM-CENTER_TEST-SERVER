import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchEvidenceUpload } from '../apps/web/src/evidence/upload-evidence';

test('CF104 duplicate originals remain blocked in the library but reusable by import tools', async () => {
  const originalFetch=globalThis.fetch;
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  let clickedLabel='확인';let mounted=0;let removed=0;let calls=0;
  // Only the platform modal boundary is stubbed; HTTP and FormData use the real shared uploader.
  class Element extends EventTarget {
    children:Element[]=[];textContent='';
    append(...elements:Element[]){this.children.push(...elements);}
    setAttribute(){} close(){} remove(){removed++;}
    showModal(){mounted++;const actions=this.children.at(-1)!;const button=actions.children.find(child=>child.textContent===clickedLabel)!;assert.ok(button);button.dispatchEvent(new Event('click'));}
  }
  Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
  Object.defineProperty(globalThis,'document',{value:{createElement:()=>new Element(),body:new Element()},configurable:true});
  const stored={id:'00000000-0000-4000-8000-000000000104',originalName:'원본.txt',storageProvider:'GOOGLE_DRIVE',driveUrl:null,downloadUrl:'/api/cases/evidence/00000000-0000-4000-8000-000000000104/download'};
  const duplicate={status:'DUPLICATE_EXACT',code:'DUPLICATE_EXACT',existing_file:{name:'원본.txt',uploader:'검수자',created_at:'2026-09-03T00:00:00Z'},file:stored};
  const url='/api/cases/00000000-0000-4000-8000-000000000100/evidence';
  const request=()=>{const form=new FormData();form.set('file',new File(['original'],'원본.txt'));return {method:'POST',body:form};};
  try {
    globalThis.fetch=async()=>{calls++;return Response.json(duplicate,{status:409});};
    assert.equal((await fetchEvidenceUpload(url,request())).status,409);
    const reused=await fetchEvidenceUpload(url,request(),{reuseExact:true});
    assert.equal(reused.status,200);assert.deepEqual(await reused.json(),{file:stored,reusedExisting:true});
    assert.equal(calls,2,'reusing an exact original must not perform a second upload');
    globalThis.fetch=async()=>Response.json({...duplicate,file:undefined},{status:409});
    assert.equal((await fetchEvidenceUpload(url,request(),{reuseExact:true})).status,409,'missing trusted file metadata must fail closed');
    clickedLabel='취소';
    const conflict={...duplicate,status:'VERSION_CONFLICT_CONFIRMATION',reviewId:'server-review',nextVersion:2};
    globalThis.fetch=async()=>Response.json(conflict,{status:409});
    assert.equal((await (await fetchEvidenceUpload(url,request(),{reuseExact:true})).json()).code,'UPLOAD_CANCELLED');
    clickedLabel='최신본으로 대체 · v2';calls=0;
    globalThis.fetch=async(_url,init)=>{calls++;if(calls===1)return Response.json(conflict,{status:409});assert.equal((init!.body as FormData).get('reviewId'),'server-review');assert.equal((init!.body as FormData).get('versionChoice'),'REPLACE_AS_LATEST');return Response.json({file:stored},{status:201});};
    assert.equal((await fetchEvidenceUpload(url,request())).status,201);assert.equal(calls,2);
    assert.equal(mounted,removed,'every confirmation removes its native modal');
  } finally {
    globalThis.fetch=originalFetch;
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');
    if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else Reflect.deleteProperty(globalThis,'window');
  }
});
