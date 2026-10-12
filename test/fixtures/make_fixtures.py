"""Genera estados financieros sintéticos (PDF texto, PDF escaneado, DOCX, XLSX, CSV) con verdad conocida.
Empresa ficticia: Distribuidora Andina S.A. Todas las cifras son inventadas."""
import json, os, random, sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, PageBreak

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
random.seed(7)
ROWS = int(sys.argv[2]) if len(sys.argv) > 2 else 120

# ---------- verdad conocida (lo que debe extraer la app) ----------
TRUTH = dict(sales24=12400000, sales23=11200000, sales22=10100000, sales21=9300000, debt=2100000, ebitda=1850000, finExp=160000,
             cash=640000, employees=112, netIncome=1020000, equity=3900000, institutions=3, overdue='no', bbDebt=700000, requested=500000)
json.dump(TRUTH, open(f'{OUT}/ground-truth.json', 'w'), indent=1)

def n(v, paren=True):
    s = f'{abs(v):,}'.replace(',', '.')
    return f'({s})' if v < 0 and paren else (f'-{s}' if v < 0 else s)

# Secciones: lista de (titulo, encabezado, filas[(concepto, nota, 2024, 2023)])
BALANCE = ('ESTADO DE SITUACIÓN FINANCIERA', ['Concepto', 'Nota', '2024', '2023'], [
    ('ACTIVOS', '', None, None),
    ('Efectivo y equivalentes de efectivo', '4', 640000, 520000), ('Cuentas por cobrar comerciales', '5', 1950000, 1720000),
    ('Inventarios', '6', 2300000, 2050000), ('Otros activos corrientes', '', 210000, 180000), ('Total activos corrientes', '', 5100000, 4470000),
    ('Propiedad, planta y equipo, neto', '7', 3400000, 3250000), ('Otros activos no corrientes', '', 450000, 420000), ('Total activos no corrientes', '', 3850000, 3670000),
    ('TOTAL ACTIVOS', '', 8950000, 8140000),
    ('PASIVOS', '', None, None),
    ('Obligaciones financieras a corto plazo', '12', 900000, 850000), ('Cuentas por pagar comerciales', '13', 1650000, 1500000),
    ('Otros pasivos corrientes', '', 400000, 380000), ('Total pasivos corrientes', '', 2950000, 2730000),
    ('Obligaciones financieras a largo plazo', '12', 1200000, 1100000), ('Impuesto diferido y provisiones', '14', 900000, 800000),
    ('Total pasivos no corrientes', '', 2100000, 1900000), ('TOTAL PASIVOS', '', 5050000, 4630000),
    ('PATRIMONIO', '', None, None),
    ('Capital social', '15', 1500000, 1500000), ('Reservas', '', 600000, 560000), ('Resultados acumulados', '', 780000, 500000),
    ('Resultado del ejercicio', '', 1020000, 950000), ('Total patrimonio', '', 3900000, 3510000),
    ('TOTAL PASIVO Y PATRIMONIO', '', 8950000, 8140000)])
RESULT = ('ESTADO DE RESULTADOS INTEGRAL', ['Concepto', 'Nota', '2024', '2023'], [
    ('Ventas netas', '16', 12400000, 11200000), ('Costo de ventas', '17', -8700000, -7900000), ('Utilidad bruta', '', 3700000, 3300000),
    ('Gastos de administración y ventas', '18', -2100000, -1900000), ('Utilidad operativa', '', 1600000, 1400000),
    ('Gastos financieros', '19', -160000, -150000), ('Utilidad antes de impuestos', '', 1440000, 1250000),
    ('Impuesto a la renta y participación a trabajadores', '20', -420000, -300000), ('Utilidad neta', '', 1020000, 950000)])
CASHFLOW = ('ESTADO DE FLUJOS DE EFECTIVO', ['Concepto', 'Nota', '2024', '2023'], [
    ('Efectivo neto generado por actividades de operación', '', 1120000, 980000), ('Efectivo utilizado en actividades de inversión', '', -540000, -410000),
    ('Efectivo generado por actividades de financiamiento', '', -460000, -300000), ('Aumento neto de efectivo', '', 120000, 270000),
    ('Efectivo y equivalentes de efectivo al inicio del periodo', '', 520000, 250000), ('Efectivo y equivalentes de efectivo al final del periodo', '', 640000, 520000)])
COMPARATIVO = ('INFORMACIÓN FINANCIERA COMPARATIVA 2021-2024 (USD)', ['Concepto', '2024', '2023', '2022', '2021'], [
    ('Ventas netas', 12400000, 11200000, 10100000, 9300000), ('EBITDA', 1850000, 1630000, 1480000, 1350000), ('Utilidad neta', 1020000, 950000, 870000, 790000)])
EBITDA = ('CONCILIACIÓN DEL EBITDA', ['Concepto', '2024', '2023'], [
    ('Utilidad operativa', 1600000, 1400000), ('(+) Depreciación y amortización', 250000, 230000), ('EBITDA', 1850000, 1630000)])
RATIOS = ('INDICADORES FINANCIEROS', ['Indicador', '2024', '2023'], [
    ('Margen EBITDA', '14,9%', '14,6%'), ('Margen neto', '8,2%', '8,5%'), ('Razón corriente', '1,73', '1,64'),
    ('Deuda financiera / EBITDA', '1,1x', '1,3x'), ('Cobertura de intereses (EBITDA / gastos financieros)', '11,6x', '10,9x'), ('Utilidad neta / ventas', '8,2%', '8,5%')])
OBLIG = ('NOTA 12 - OBLIGACIONES FINANCIERAS', ['Institución', 'Tipo', 'Saldo 2024'], [
    ('Banco Alfa (el Banco)', 'Préstamo comercial', 700000), ('Banco Beta', 'Préstamo comercial', 800000), ('Cooperativa Gamma', 'Línea de crédito', 600000), ('Total obligaciones financieras', '', 2100000)])
EFECTIVO = ('NOTA 4 - EFECTIVO Y EQUIVALENTES DE EFECTIVO', ['Concepto', '2024', '2023'], [
    ('Caja', 15000, 12000), ('Bancos locales', 425000, 408000), ('Certificados de depósito', 200000, 100000), ('Total efectivo y equivalentes de efectivo', 640000, 520000)])
SOLICITUD = [('Razón social', 'Distribuidora Andina S.A.'), ('Deuda solicitada (incremento de riesgo)', '$ 500.000'), ('Deuda actual con el banco', '$ 700.000'),
             ('Deuda en el sistema financiero', '$ 2.100.000'), ('Instituciones financieras con deuda', '3'), ('Número de empleados', '112'),
             ('¿Accionista ha reportado vencidos?', 'No')]
POLITICAS = ('Los estados financieros han sido preparados de acuerdo con las Normas Internacionales de Información Financiera para Pequeñas y Medianas Entidades (NIIF para las PYMES) y se presentan en dólares de los Estados Unidos de América. '
             'La Compañía reconoce los ingresos de actividades ordinarias cuando transfiere el control de los bienes al cliente, normalmente en el momento de la entrega. Los inventarios se valoran al menor entre el costo y el valor neto realizable, aplicando el método de costo promedio ponderado. '
             'La propiedad, planta y equipo se deprecia por el método de línea recta durante su vida útil estimada. Las obligaciones financieras se miden al costo amortizado utilizando la tasa de interés efectiva. ')
ANEXO_ROWS = [(f'Cliente {i:03d} - cartera vigente', random.randint(2000, 90000), random.randint(0, 20000), random.randint(0, 9000)) for i in range(1, ROWS + 1)]
INV_ROWS = [(f'Producto {i:03d} - existencias', random.randint(100, 5000), random.randint(5, 400), 0) for i in range(1, ROWS + 1)]

# ---------- PDF (texto) ----------
def build_pdf(path, scanned_pages=False, extra=True):
    st = getSampleStyleSheet()
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    el = [Paragraph('Distribuidora Andina S.A.', st['Title']), Paragraph('Estados financieros al 31 de diciembre de 2024 y 2023 (expresados en USD)', st['Heading3']),
          Spacer(1, 12), Paragraph('SOLICITUD DE CRÉDITO - DATOS DEL EXPEDIENTE', st['Heading2'])]
    t = Table([[a, b] for a, b in SOLICITUD], colWidths=[9*cm, 7*cm]); t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), .4, colors.grey), ('FONTSIZE', (0, 0), (-1, -1), 9)])); el += [t, PageBreak()]
    def table(title, head, rows, note_col=True):
        data = [head]
        for r in rows:
            if r[2] is None if len(r) > 3 and head[1] == 'Nota' else False:
                data.append([r[0]] + [''] * (len(head) - 1))
            else:
                data.append([r[0]] + [(n(c) if isinstance(c, int) else c) for c in r[1:]])
        tb = Table(data, repeatRows=1)
        tb.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), .3, colors.grey), ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey), ('FONTSIZE', (0, 0), (-1, -1), 8), ('ALIGN', (1, 0), (-1, -1), 'RIGHT')]))
        return [Paragraph(title, st['Heading2']), tb, Spacer(1, 10)]
    for sec in (BALANCE, RESULT):
        el += table(sec[0], sec[1], sec[2]); el.append(PageBreak())
    el += table(*CASHFLOW); el += table(*COMPARATIVO); el.append(PageBreak())
    if extra:
        for sec in (EBITDA, RATIOS, EFECTIVO, OBLIG):
            el += table(*sec)
        el += [Paragraph('NOTA 1 - POLÍTICAS CONTABLES SIGNIFICATIVAS', st['Heading2'])] + [Paragraph(POLITICAS, st['BodyText']) for _ in range(14)]
        el += [Paragraph('NOTA 21 - PERSONAL', st['Heading2']), Paragraph('Al 31 de diciembre de 2024 la Compañía mantiene 112 empleados (2023: 104). Ninguno de los accionistas registra operaciones vencidas en la Central de Riesgos.', st['BodyText']), PageBreak()]
        el += table('ANEXO A - CARTERA POR CLIENTE', ['Cliente', 'Vigente', '1-30 días', '31-60 días'], ANEXO_ROWS)
        el += table('ANEXO B - INVENTARIO POR PRODUCTO', ['Producto', 'Unidades', 'Costo unitario', 'Obsoleto'], INV_ROWS)
    doc.build(el)

build_pdf(f'{OUT}/estados-financieros.pdf')

# ---------- DOCX ----------
from docx import Document
def build_docx(path):
    d = Document(); d.add_heading('Distribuidora Andina S.A.', 0); d.add_paragraph('Estados financieros al 31 de diciembre de 2024 y 2023 (USD)')
    d.add_heading('SOLICITUD DE CRÉDITO - DATOS DEL EXPEDIENTE', 1)
    t = d.add_table(rows=0, cols=2); t.style = 'Table Grid'
    for a, b in SOLICITUD:
        c = t.add_row().cells; c[0].text, c[1].text = a, b
    def tab(title, head, rows):
        d.add_heading(title, 1); tb = d.add_table(rows=1, cols=len(head)); tb.style = 'Table Grid'
        for i, h in enumerate(head): tb.rows[0].cells[i].text = h
        for r in rows:
            cells = tb.add_row().cells; vals = [r[0]] + [(n(c) if isinstance(c, int) else ('' if c is None else c)) for c in r[1:]]
            for i, v in enumerate(vals): cells[i].text = str(v)
    for sec in (BALANCE, RESULT, CASHFLOW, COMPARATIVO, EBITDA, RATIOS, EFECTIVO, OBLIG): tab(*sec)
    d.add_heading('NOTA 1 - POLÍTICAS CONTABLES SIGNIFICATIVAS', 1)
    for _ in range(14): d.add_paragraph(POLITICAS)
    d.add_heading('NOTA 21 - PERSONAL', 1); d.add_paragraph('Al 31 de diciembre de 2024 la Compañía mantiene 112 empleados (2023: 104). Ninguno de los accionistas registra operaciones vencidas en la Central de Riesgos.')
    tab('ANEXO A - CARTERA POR CLIENTE', ['Cliente', 'Vigente', '1-30 días', '31-60 días'], ANEXO_ROWS)
    d.save(path)
build_docx(f'{OUT}/estados-financieros.docx')

# ---------- XLSX (números reales con formato contable, varias hojas) ----------
from openpyxl import Workbook
def build_xlsx(path):
    wb = Workbook(); fmt = '#,##0;(#,##0)'
    def sheet(name, head, rows, first=False):
        ws = wb.active if first else wb.create_sheet(); ws.title = name; ws.append([name]); ws.append(head)
        for r in rows:
            ws.append([r[0]] + [('' if c is None else c) for c in r[1:]])
        for row in ws.iter_rows(min_row=3):
            for c in row[1:]:
                if isinstance(c.value, (int, float)) and not (head[1] == 'Nota'): c.number_format = fmt
                elif isinstance(c.value, (int, float)): c.number_format = fmt
    ws = wb.active; ws.title = 'Solicitud'
    for a, b in SOLICITUD: ws.append([a, b])
    def conv(sec):  # la columna Nota queda como texto
        return [(r[0],) + tuple((c if not isinstance(c, str) or c == '' or not c.isdigit() else int(c)) for c in r[1:]) for r in sec[2]]
    sheet('Balance', BALANCE[1], conv(BALANCE)); sheet('Resultados', RESULT[1], conv(RESULT)); sheet('Flujo de efectivo', CASHFLOW[1], conv(CASHFLOW))
    sheet('Comparativo', COMPARATIVO[1], COMPARATIVO[2]); sheet('EBITDA', EBITDA[1], EBITDA[2]); sheet('Indicadores', RATIOS[1], RATIOS[2])
    sheet('Nota 4 Efectivo', EFECTIVO[1], EFECTIVO[2]); sheet('Nota 12 Obligaciones', OBLIG[1], OBLIG[2]); sheet('Anexo A Cartera', ['Cliente', 'Vigente', '1-30 días', '31-60 días'], ANEXO_ROWS)
    sheet('Anexo B Inventario', ['Producto', 'Unidades', 'Costo unitario', 'Obsoleto'], INV_ROWS)
    wb.save(path)
build_xlsx(f'{OUT}/estados-financieros.xlsx')

# ---------- CSV (separador ;, miles con punto: exportación de Excel en español) ----------
def build_csv(path):
    L = ['Distribuidora Andina S.A.;Estados financieros al 31 de diciembre de 2024 y 2023 (USD)', '', 'SOLICITUD DE CRÉDITO - DATOS DEL EXPEDIENTE']
    L += [f'{a};{b}' for a, b in SOLICITUD] + ['']
    for title, head, rows in (BALANCE, RESULT, CASHFLOW, COMPARATIVO, EBITDA, RATIOS, EFECTIVO, OBLIG):
        L += [title, ';'.join(head)] + [';'.join([r[0]] + [(n(c) if isinstance(c, int) else ('' if c is None else str(c))) for c in r[1:]]) for r in rows] + ['']
    L += ['ANEXO A - CARTERA POR CLIENTE', 'Cliente;Vigente;1-30 días;31-60 días'] + [';'.join([r[0]] + [n(c) for c in r[1:]]) for r in ANEXO_ROWS]
    L += ['ANEXO B - INVENTARIO POR PRODUCTO', 'Producto;Unidades;Costo unitario;Obsoleto'] + [';'.join([r[0]] + [n(c) for c in r[1:]]) for r in INV_ROWS]
    open(path, 'w', encoding='utf-8-sig').write('\n'.join(L))
build_csv(f'{OUT}/estados-financieros.csv')

# ---------- PDF escaneado (solo imagen): obliga al OCR a leer píxeles ----------
import subprocess, glob
from PIL import Image
subprocess.run(['pdftoppm', '-r', '110', '-f', '1', '-l', '5', '-png', f'{OUT}/estados-financieros.pdf', f'{OUT}/_pg'], check=True)
pages = [Image.open(p).convert('L') for p in sorted(glob.glob(f'{OUT}/_pg*.png'))]
pages[0].save(f'{OUT}/estados-financieros-escaneado.pdf', save_all=True, append_images=pages[1:], resolution=110)
for p in glob.glob(f'{OUT}/_pg*.png'): os.remove(p)

for f in sorted(os.listdir(OUT)):
    print(f'{os.path.getsize(os.path.join(OUT, f)):>9,} B  {f}')
