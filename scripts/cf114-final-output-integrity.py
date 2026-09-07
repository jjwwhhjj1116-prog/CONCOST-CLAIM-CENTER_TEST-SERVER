from pathlib import Path
import hashlib, json, io, sys
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from pypdf import PdfReader
from PIL import Image

root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'artifacts'/'cf114'
sha=lambda value:hashlib.sha256(value).hexdigest()
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
with ZipFile(root/'cf114-report.docx') as docx:
    assert docx.testzip() is None
    document=ET.fromstring(docx.read('word/document.xml'))
    relations=ET.fromstring(docx.read('word/_rels/document.xml.rels'))
    rels={node.attrib['Id']:node.attrib['Target'] for node in relations}
    docx_images=[docx.read('word/'+rels[node.attrib['{'+ns['r']+'}embed']]) for node in document.findall('.//a:blip',ns)]
    paper=document.find('.//w:pgSz',ns).attrib
    breaks=len(document.findall('.//w:pageBreakBefore',ns))
with ZipFile(root/'cf114-report.hwpx') as hwpx:
    assert hwpx.testzip() is None
    hwpx_images=[hwpx.read(name) for name in sorted(hwpx.namelist()) if name.startswith('BinData/page-') and name.endswith('.jpg')]
    section=ET.fromstring(hwpx.read('Contents/section0.xml'))
    hwp_paper=next(node.attrib for node in section.iter() if node.tag.endswith('}pagePr'))
    pictures=sum(node.tag.endswith('}pic') for node in section.iter())
reader=PdfReader(root/'cf114-report.pdf')
pdf_images=[]
for page in reader.pages:
    names=[operands[0] for operands,operator in page.get_contents().operations if operator==b'Do']
    assert len(names)==1
    pdf_images.append(page['/Resources']['/XObject'][names[0]].get_data())
image_checks=[]
for index,data in enumerate(docx_images):
    image=Image.open(io.BytesIO(data)).convert('RGB')
    pixels=list(image.resize((200,140)).getdata())
    ink=sum(sum(pixel)<700 for pixel in pixels)/len(pixels)
    image_checks.append({'page':index+1,'size':image.size,'sha256':sha(data),'inkRatio':round(ink,4),'pdfSame':data==pdf_images[index],'hwpxSame':data==hwpx_images[index]})
assert len(docx_images)==len(pdf_images)==len(hwpx_images)==pictures==3
assert breaks==2
assert int(paper['{'+ns['w']+'}w'])==16838 and int(paper['{'+ns['w']+'}h'])==11906
assert paper['{'+ns['w']+'}orient']=='landscape'
assert hwp_paper['width']=='59520' and hwp_paper['height']=='84180' and hwp_paper['landscape']=='NARROWLY'
assert all(check['pdfSame'] and check['hwpxSame'] and check['inkRatio']>.01 for check in image_checks),image_checks
assert all(abs(float(page.mediabox.width)-841.89)<.1 and abs(float(page.mediabox.height)-595.28)<.1 for page in reader.pages)
result={'passed':True,'pageCount':3,'docxPaper':paper,'hwpxPaper':hwp_paper,'pdfPaper':[list(map(float,page.mediabox)) for page in reader.pages],'images':image_checks,'files':{name:{'bytes':(root/name).stat().st_size,'sha256':sha((root/name).read_bytes())}for name in ['cf114-report.pdf','cf114-report.docx','cf114-report.hwpx']}}
(root/'output-integrity.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
