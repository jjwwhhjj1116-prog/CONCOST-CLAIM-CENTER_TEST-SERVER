"""Synthetic fixtures only. No business data, keys, or network calls."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader

out = Path(__file__).resolve().parents[1] / 'tmp' / 'cf115-fixtures'
out.mkdir(parents=True, exist_ok=True)
lines = [
    'CF115 자동정리 검증용 - 실제 업무 아님',
    '회의명: 시험 도면 검토 회의',
    '회의일시: 2026년 9월 7일 오전 10시',
    '회의장소: 합성 회의실',
    '작성자: 김검수 / 소속: 시험팀 / 직급: 연구원',
    '참석자(컨코스트): 김검수, 이확인',
    '참석자(거래처): 박요청',
    '거래처명: 합성 발주처',
    '회의내용 및 지시사항',
    '김검수: 9월 9일까지 원도면과 수량을 대조하겠습니다.',
    '박요청: 추가 금액은 아직 확정하지 않았습니다.',
    '이확인: 누수 여부는 사진만으로 판단할 수 없습니다.',
    '누수 확인 담당자와 다음 회의 날짜는 정하지 않았습니다.',
    '원도면을 먼저 확인한 후 추가 조사를 협의하기로 했습니다.',
]
image = Image.new('RGB', (1240, 1754), 'white')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/malgun.ttf', 30)
title = ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', 34)
for index, line in enumerate(lines):
    draw.text((65, 85 + index * 78), line, fill='#172033', font=title if index == 0 else font)
image.save(out / 'cf115-scan.png')
pdf = canvas.Canvas(str(out / 'cf115-scan.pdf'), pagesize=A4)
pdf.drawImage(str(out / 'cf115-scan.png'), 0, 0, width=A4[0], height=A4[1])
pdf.save()
doc = PdfReader(out / 'cf115-scan.pdf')
assert not doc.pages[0].extract_text().strip(), 'Must be a true image-only OCR fixture.'
(out / 'cf115-meeting.txt').write_text('\n'.join(lines), encoding='utf-8')
print({'directory': str(out), 'pdf_pages': len(doc.pages), 'pdf_has_text_layer': False})
