function fakeSheets(initial = {}) {
  const tables = structuredClone(initial);
  const ids = new Map(Object.keys(tables).map((title, index) => [title, index + 1]));
  const calls = [];
  let nextId = ids.size + 1;
  const column = letters => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  function rangeParts(range) {
    const [tab, cells] = range.split('!');
    const match = /^([A-Z]+)(\d*)?(?::([A-Z]+)(\d*)?)?$/.exec(cells);
    if (!tables[tab]) throw new Error('Missing tab ' + tab);
    return { tab, startColumn: column(match[1]), endColumn: column(match[3] || match[1]),
      startRow: Number(match[2] || 1) - 1, endRow: match[4] ? Number(match[4]) - 1 : match[2] ? Number(match[2]) - 1 : tables[tab].length - 1 };
  }
  function read(range) {
    const r = rangeParts(range);
    return structuredClone(tables[r.tab].slice(r.startRow, r.endRow + 1)
      .map(row => row.slice(r.startColumn, r.endColumn + 1)));
  }
  function write(range, values) {
    const r = rangeParts(range);
    values.forEach((row, index) => {
      const target = tables[r.tab][r.startRow + index] ||= [];
      row.forEach((value, offset) => { target[r.startColumn + offset] = value; });
    });
  }
  const sheets = { spreadsheets: {
    get: async request => { calls.push(['metadata', request]); return { data: { sheets: [...ids].map(([title, sheetId]) => ({ properties: { title, sheetId } })) } }; },
    batchUpdate: async request => {
      calls.push(['structure', request]);
      const replies = request.requestBody.requests.map(action => {
        if (action.addSheet) {
          const title = action.addSheet.properties.title;
          if (ids.has(title)) { const error = new Error('Duplicate title'); error.code = 400; throw error; }
          const sheetId = nextId++; ids.set(title, sheetId); tables[title] = [];
          return { addSheet: { properties: { title, sheetId } } };
        }
        if (action.deleteSheet) {
          const title = [...ids].find(([, id]) => id === action.deleteSheet.sheetId)?.[0];
          ids.delete(title); delete tables[title]; return {};
        }
        throw new Error('Unsupported action');
      });
      return { data: { replies } };
    },
    values: {
      get: async request => { calls.push(['get', request]); return { data: { values: read(request.range) } }; },
      batchGet: async request => { calls.push(['batchGet', request]); return { data: { valueRanges: request.ranges.map(range => ({ values: read(range) })) } }; },
      update: async request => { calls.push(['update', request]); write(request.range, request.requestBody.values); return { data: {} }; },
      batchUpdate: async request => { calls.push(['batchUpdate', request]); request.requestBody.data.forEach(item => write(item.range, item.values)); return { data: {} }; },
      append: async request => { calls.push(['append', request]); const tab = request.range.split('!')[0]; tables[tab].push(...structuredClone(request.requestBody.values)); return { data: {} }; }
    }
  } };
  return { sheets, tables, calls };
}
module.exports = { fakeSheets };
