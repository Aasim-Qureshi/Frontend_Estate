import sys
sys.stdout.reconfigure(encoding='utf-8')
lines=open('src/ui/i18n/translations/ar.json','r',encoding='utf-8').read().splitlines()
for i in range(660,700):
    if i < len(lines):
        print(f'{i+1:04}: {lines[i]}')
