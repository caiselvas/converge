# Voice manual test

1. Set `CONVERGE_VOICE_PROVIDER=openai_realtime` and configure an OpenAI key in the ignored `.env`. Restart the backend. On a phone, open the frontend through a private HTTPS tunnel. Reset the synthetic demo if needed.
2. Open Ask on Expenses and select **Voice discovery**. Grant microphone access. Check for the AI introduction, one question, a listening indicator and the countdown.
3. Say “I want a sabbatical with CHF 15,000 in May 2028.” Check the transcript and **What I understood** for your exact words. Answer the priority question and say “prefer not to say” when asked about sensitivity or comfort. Try interrupting once.
4. Confirm the goal, amount and month. Select **Draft confirmed goals**, then **Add to draft**. Check that the DraftBar and Goals reflect the pending change. Ask a what-if and verify its cash result against Overview.
5. Select **End** and check that the browser releases the microphone. Start again and test inactivity and page hiding. Check that typed Ask still works if microphone access is denied or the provider is off.
6. Select **Clear discovery memory**. Reopen Ask and verify the viewer’s memory and transcript are gone. Repeat the phone flow after enabling local mode if the optional models are installed.
