# CLAUDE.md: Stay Focus (PWA)

אפליקציה אישית לניהול פרויקטים, משימות, ספרינטים, שגרה ואתגרים, במקום מערכת Stay Focus שב-Notion. PWA לאייפון, אופליין מלא, בלי שרת. האפיון המלא ב-`SPEC.md`. **קרא אותו לפני כל שינוי.**

אלכס לא מפתח: הסברים בשפה פשוטה, ופקודות מוכנות להעתקה.

## איך עובדים

- `SPEC.md` הוא מקור האמת. שינוי נכתב קודם שם (כולל שורה ביומן השינויים, נספח א'), ורק אחר כך בקוד.
- כל כלל מופיע פעם אחת עם מספר (למשל R-TOD-5). בקוד ובבדיקות מפנים אליו במספר.
- **לא מוסיפים פיצ'ר שלא באפיון בלי לשאול.** אלכס ביקש להתייעץ לפני כל תוספת.
- משהו לא ברור או סותר: עוצרים ושואלים.
- commit בסוף כל שלב עם בדיקות ירוקות. הודעות commit בעברית.

## כללי ברזל

1. **אין שרת ואין fetch**, חוץ ממזג אוויר ב-`src/services/weather.ts` (Open-Meteo, רק קו רוחב ואורך). ESLint חוסם fetch בכל מקום אחר.
2. **לוגיקה ב-`src/domain/`** כפונקציות טהורות עם בדיקות. ה-UI לא מחשב כללים.
3. **ה-UI ניגש למסד רק דרך `src/services/`.**
4. **אסור לאבד נתונים:** כל שינוי סכמה = `db.version(n+1)` חדש ב-`src/db/db.ts` + צעד ב-`MIGRATIONS` ב-`src/services/backup.ts`.
5. **מסך היום נגזר מהנתונים** (SPEC 4). כרטיס מותנה מופיע רק כשיש בו משהו.

## סטאק

TypeScript strict · React 19 + Vite · Dexie + dexie-react-hooks · Zod · date-fns · vite-plugin-pwa · Vitest + fake-indexeddb · ESLint. CSS רגיל עם tokens ב-`src/ui/styles.css`. עיצוב: רקע לבן, שחור, אינדיגו `#3346C4`.

## מוסכמות

- ממשק בעברית, RTL. טקסטים למשתמש ב-`src/ui/strings.he.ts` או ישירות ברכיב כשהם קצרים וחד-פעמיים.
- קוד, שמות קבצים וטיפוסים באנגלית. הערות קצרות.
- תאריכים `YYYY-MM-DD` באחסון, שבוע מתחיל בראשון.
- ניתוב hash (`#/tasks/abc`).

## פקודות

Node נמצא ב-`~/.local/node/bin`:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
```

| פקודה | מה עושה |
| --- | --- |
| `npm run dev` | שרת פיתוח |
| `npm test` | בדיקות יחידה |
| `npm run lint` | ESLint |
| `npm run build` | בדיקת טיפוסים + בנייה + service worker |
| `npm run icons` | אייקוני PWA מ-`public/icon.svg` |

פרסום: push ל-`main` מריץ lint, בדיקות, build ו-GitHub Pages (`.github/workflows/deploy.yml`). אלכס מריץ `git push` בטרמינל שלו (אין gh CLI).

## מצב

- 30/09/2026: אפיון 1.0 אושר (שלוש סקיצות ב-`Claude outputs/`, הסופית `dashboard-v3.html`).
- 01/10/2026: כל השלבים 0–8 נבנו ונבדקו בדפדפן בגודל אייפון. 45 בדיקות יחידה עוברות, lint ו-build נקיים.
- מבנה UI: `src/ui/App.tsx` (ניתוב), `screens/` (Today, Tasks, Task, Sprint, Projects+Goals, Notes, Habits = אתגרים/שגרות/חוזרות/כרטיסי מידע, More = חיפוש/גיבוי/מזג אוויר/הגדרות/תחומים/תבניות), `components/` (common, tasks, edit, Icon).
- טקסט שהמשתמש מקליד מוצג עם `unicode-bidi: plaintext` כדי שעברית ואנגלית מעורבות לא יתהפכו. תאריך מחותמת זמן: תמיד `localDate()`, לעולם לא `slice(0, 10)`.
- הרצה מקומית בתצוגה המקדימה: `.claude/launch.json` (פורט 5174, לא ב-git).
- עוד לא פורסם: צריך ליצור מאגר `MorohJr/Stay-Focus` ב-GitHub ולהפעיל Pages (Source: GitHub Actions).
