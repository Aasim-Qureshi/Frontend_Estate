import sys, json, pathlib
sys.stdout.reconfigure(encoding='utf-8')
path=pathlib.Path('src/ui/i18n/translations/ar.json')
data=json.loads(path.read_text(encoding='utf-8'))
print(data['submitReportsQuickly']['validationModal']['panelHeader'])
