# TypingMind-LaTeX-Fix

**This is 100% AI slop. I will try but am unlikely able to help you with any problems you face in using this extension.**

If you use TypingMind for anything maths related, you will come to realise that the built-in LaTeX rendering works inconsistently.

For example:

-   `$...$` is not recognised as inline LaTeX (There is a good reason for this, which is that `$` symbols are used very frequently. Nonetheless I would still prefer things within `$...$` to be recognised as inline LaTeX).
-   `\(...\)` for inline, `\[...\]` for display works sometimes but not always. I have been unable to recreate the circumstances of which they work consistently. - (1)
-   (1) applies for
    ```
    \(
    ...
    \)
    ```
    ```
    \[
    ...
    \]
    ```
    as well - (2)

There are different ways to overcome these problems, some including modifying your system instructions for the AI models (e.g. "Wrap all maths LaTeX expressions within `$$...$$`." In my experience, this is the most frustrating part of using TypingMind. It requires extensive prompting for this to work and it does not work consistently. Worst of all, it sometimes has unintended side-effects such as formatting being messed up in other areas other than maths in my day-to-day use.)

This extension attempts to solve all of these problems. **It is fully functional except (1) and (2) which I had difficulty in implementing.** I welcome anyone willing to help.

To get this to work, simply add the following link into your TypingMind extensions:
https://cdn.jsdelivr.net/gh/pesschap/TypingMind-LaTeX-Fix@main/typingmindlatexfix.js

**I am cognisant that I may have been mistakenly referencing 'LaTeX' wrongly.**

Hope this helps!
