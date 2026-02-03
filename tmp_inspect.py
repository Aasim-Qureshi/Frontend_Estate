import json, pathlib
path = pathlib.Path('src/ui/i18n/translations/en.json')
data=json.loads(path.read_text(encoding='utf-8'))
print('keys', list(data.keys())[:5])
print('panelHeader', data['validation']['panelHeader'])
