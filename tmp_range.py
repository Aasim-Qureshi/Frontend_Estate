import pathlib
lines=pathlib.Path('src/ui/screens/SubmitReportsQuickly.jsx').read_text(encoding='utf-8').splitlines()
for i in range(560,610):
    print(f'{i+1:04}: {lines[i]}')
