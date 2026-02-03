lines=open('src/ui/i18n/translations/en.json','r',encoding='utf-8').read().splitlines()
for i in range(810,835):
    if i < len(lines):
        print(f'{i+1:04}: {lines[i]}')
