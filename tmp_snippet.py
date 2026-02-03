lines=open('src/ui/i18n/translations/en.json','r',encoding='utf-8').read().splitlines()
for i in range(680,740):
    print(f'{i+1:04}: {lines[i]}')
