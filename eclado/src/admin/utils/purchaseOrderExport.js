export function formatUsd(value) {
  return `USD$${Number(value || 0).toFixed(2)}`;
}

export function formatTwd(value) {
  return `NT$${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
}

function safeFilename(value) {
  return String(value || 'purchase-order').replace(/[\\/:*?"<>|]/g, '-');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPurchaseOrderExcel(order) {
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ECLADO Taiwan';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('Purchase Order', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });

  sheet.columns = [
    { key: 'sku', width: 17 },
    { key: 'nameZh', width: 30 },
    { key: 'nameEn', width: 36 },
    { key: 'qty', width: 10 },
    { key: 'unitCost', width: 22 },
    { key: 'subtotal', width: 18 },
  ];

  sheet.mergeCells('A1:F1');
  const title = sheet.getCell('A1');
  title.value = 'PURCHASE ORDER (叫貨單)';
  title.font = { name: 'Arial', size: 22, bold: true, color: { argb: 'FF1A1A18' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 36;

  const meta = [
    [`PO Number: ${order.po_number || '儲存後產生'}`],
    ['Supplier / 供應來源: ECLADO'],
    [`Status: ${order.status || 'draft'}`],
    [`Created: ${new Date(order.created_at || Date.now()).toLocaleString('zh-TW')}`],
  ];
  meta.forEach((values, index) => {
    const row = 3 + index;
    sheet.mergeCells(row, 1, row, 6);
    sheet.getCell(row, 1).value = values[0];
    sheet.getCell(row, 1).font = { name: 'Arial', size: 11, color: { argb: 'FF333333' } };
  });

  const address = String(order.shipping_address?.address_text || '').trim();
  sheet.mergeCells('A7:F8');
  sheet.getCell('A7').value = `Shipping Address / 收件地址:\n${address}`;
  sheet.getCell('A7').alignment = { vertical: 'top', wrapText: true };
  sheet.getCell('A7').font = { name: 'Arial', size: 11, color: { argb: 'FF333333' } };
  sheet.getRow(7).height = 30;
  sheet.getRow(8).height = 24;

  const headerRow = 10;
  const headers = ['Product Code', 'Chinese Name', 'English Name', 'Qty', 'Unit Price', 'Subtotal'];
  sheet.getRow(headerRow).values = headers;
  sheet.getRow(headerRow).height = 24;
  sheet.getRow(headerRow).eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A18' } };
    cell.alignment = { vertical: 'middle' };
  });

  (order.items || []).forEach((item, index) => {
    const rowNumber = headerRow + 1 + index;
    const row = sheet.getRow(rowNumber);
    row.values = [
      item.product_sku,
      [item.name_zh, item.specification].filter(Boolean).join(' '),
      item.name_en || '—',
      Number(item.quantity || 0),
      Number(item.unit_cost || 0),
      { formula: `D${rowNumber}*E${rowNumber}`, result: Number(item.subtotal_usd || 0) },
    ];
    row.height = 24;
    row.alignment = { vertical: 'middle', wrapText: true };
    row.font = { name: 'Arial', size: 10.5, color: { argb: 'FF333333' } };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(5).numFmt = '"USD$"#,##0.00';
    row.getCell(6).numFmt = '"USD$"#,##0.00';
    row.getCell(5).alignment = { horizontal: 'right' };
    row.getCell(6).alignment = { horizontal: 'right' };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE8E8E6' } } };
    });
  });

  const firstItemRow = headerRow + 1;
  const lastItemRow = Math.max(firstItemRow, headerRow + (order.items || []).length);
  const totalRow = lastItemRow + 2;
  sheet.getCell(`E${totalRow}`).value = 'USD Total:';
  sheet.getCell(`F${totalRow}`).value = {
    formula: `SUM(F${firstItemRow}:F${lastItemRow})`,
    result: Number(order.total_usd || 0),
  };
  for (let columnNumber = 5; columnNumber <= 6; columnNumber += 1) {
    const cell = sheet.getCell(totalRow, columnNumber);
    cell.font = { name: 'Arial', size: 11, bold: true };
    cell.alignment = { horizontal: 'right' };
  }
  sheet.getCell(`F${totalRow}`).numFmt = '"USD$"#,##0.00';
  sheet.autoFilter = `A${headerRow}:F${lastItemRow}`;
  sheet.pageSetup.printArea = `A1:F${totalRow}`;
  sheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0, footer: 0 };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeFilename(order.po_number)}.xlsx`,
  );
}

async function renderDocument(element) {
  if (!element) throw new Error('找不到叫貨單預覽內容');
  if (document.fonts?.ready) await document.fonts.ready;
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
  });
}

export async function exportPurchaseOrderPng(order, element) {
  const canvas = await renderDocument(element);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1));
  if (!blob) throw new Error('PNG 產生失敗');
  downloadBlob(blob, `${safeFilename(order.po_number)}.png`);
}

function canvasRangeForElement(sourceCanvas, sourceElement, targetElement) {
  const sourceRect = sourceElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const scaleY = sourceCanvas.height / sourceRect.height;
  const top = Math.max(0, Math.floor((targetRect.top - sourceRect.top) * scaleY));
  const bottom = Math.min(
    sourceCanvas.height,
    Math.ceil((targetRect.bottom - sourceRect.top) * scaleY),
  );
  return { top, height: Math.max(0, bottom - top) };
}

function buildPdfPageSlices(sourceCanvas, sourceElement, maxPageHeight) {
  const table = sourceElement.querySelector('table');
  const tableHead = table?.querySelector('thead');
  const rows = Array.from(table?.querySelectorAll('tbody tr') || []);

  if (!table || !tableHead || rows.length === 0) {
    const pages = [];
    for (let top = 0; top < sourceCanvas.height; top += maxPageHeight) {
      pages.push([{ top, height: Math.min(maxPageHeight, sourceCanvas.height - top) }]);
    }
    return pages;
  }

  const head = canvasRangeForElement(sourceCanvas, sourceElement, tableHead);
  const rowSlices = rows.map(row => canvasRangeForElement(sourceCanvas, sourceElement, row));
  const tableRange = canvasRangeForElement(sourceCanvas, sourceElement, table);
  const preamble = { top: 0, height: rowSlices[0].top };
  const tailTop = tableRange.top + tableRange.height;
  const tail = { top: tailTop, height: Math.max(0, sourceCanvas.height - tailTop) };
  const pages = [];
  let current = [];
  let usedHeight = 0;

  const finishPage = () => {
    if (current.length > 0) pages.push(current);
    current = [];
    usedHeight = 0;
  };

  const addSlice = (slice) => {
    if (!slice || slice.height <= 0) return;
    current.push(slice);
    usedHeight += slice.height;
  };

  addSlice(preamble);
  rowSlices.forEach((row) => {
    if (usedHeight + row.height > maxPageHeight && current.length > 0) {
      finishPage();
      addSlice(head);
    }
    addSlice(row);
  });

  if (tail.height > 0) {
    if (usedHeight + tail.height > maxPageHeight && current.length > 0) finishPage();
    addSlice(tail);
  }
  finishPage();
  return pages;
}

function composeCanvasPage(sourceCanvas, slices) {
  const pageHeight = slices.reduce((sum, slice) => sum + slice.height, 0);
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = sourceCanvas.width;
  pageCanvas.height = Math.max(1, pageHeight);
  const context = pageCanvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  let destinationY = 0;
  slices.forEach((slice) => {
    context.drawImage(
      sourceCanvas,
      0,
      slice.top,
      sourceCanvas.width,
      slice.height,
      0,
      destinationY,
      sourceCanvas.width,
      slice.height,
    );
    destinationY += slice.height;
  });
  return pageCanvas;
}

export async function exportPurchaseOrderPdf(order, element) {
  const canvas = await renderDocument(element);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const margin = 10;
  const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = pdf.internal.pageSize.getHeight() - margin * 2;
  const maxCanvasPageHeight = Math.floor(canvas.width * pageHeight / pageWidth);
  const pages = buildPdfPageSlices(canvas, element, maxCanvasPageHeight);

  pages.forEach((slices, index) => {
    if (index > 0) pdf.addPage('a4', 'landscape');
    const pageCanvas = composeCanvasPage(canvas, slices);
    const renderedHeight = pageCanvas.height * pageWidth / pageCanvas.width;
    pdf.addImage(
      pageCanvas.toDataURL('image/png'),
      'PNG',
      margin,
      margin,
      pageWidth,
      renderedHeight,
      undefined,
      'FAST',
    );
  });
  pdf.save(`${safeFilename(order.po_number)}.pdf`);
}
