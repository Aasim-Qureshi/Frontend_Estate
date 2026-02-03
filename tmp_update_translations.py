import json, pathlib
for lang, text in [('en', 'Validation on Excel sheet'), ('ar', 'التحقق من ملف الإكسل')]:
    path = pathlib.Path(f'src/ui/i18n/translations/{lang}.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    data.pop('validation', None)
    submit = data.setdefault('submitReportsQuickly', {})
    validation = submit.setdefault('validation', {})
    validation['panelHeader'] = text
    path.write_text(json.dumps(data, ensure_ascii=False, indent=4) + '\n', encoding='utf-8')
