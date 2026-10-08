import { describe, expect, test } from "vitest";
import { Faults, LONG, MOST, PACE, told } from "../src/fault";
import type { Fault } from "../src/fault";

const fault = (detail: string): Fault => ({ at: "2099-01-01T00:00:00.000Z", what: "lost", detail, agent: "a browser", screen: "412x915@2.625" });

// The reports that were sent, and a clock whose timer runs when the test says.
function page() {
  const sent: string[] = [];
  const waits: number[] = [];
  let due: (() => void) | undefined;
  const faults = new Faults(
    (f) => void sent.push(f.detail),
    (then, ms) => {
      waits.push(ms);
      due = then;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
  const tick = () => {
    const then = due;
    due = undefined;
    then?.();
  };
  return { faults, sent, waits, tick };
}

describe("the page's reports", () => {
  test("wait until the page knows a script serves it, and then go in order, one every PACE", () => {
    const { faults, sent, waits, tick } = page();
    faults.report(fault("first"));
    faults.report(fault("second"));
    expect(sent).toEqual([]);
    faults.served(true);
    expect(sent).toEqual(["first"]);
    faults.report(fault("third"));
    expect(sent).toEqual(["first"]);
    tick();
    expect(sent).toEqual(["first", "second"]);
    tick();
    tick();
    expect(sent).toEqual(["first", "second", "third"]);
    expect(new Set(waits)).toEqual(new Set([PACE]));
    // After a pause the next one goes at once.
    faults.report(fault("fourth"));
    expect(sent).toHaveLength(4);
  });

  test("go nowhere from the snapshot's page", () => {
    const { faults, sent, tick } = page();
    faults.report(fault("before"));
    faults.served(false);
    faults.report(fault("after"));
    tick();
    expect(sent).toEqual([]);
  });

  test("are MOST of a visit, and no more", () => {
    const { faults, sent, tick } = page();
    faults.served(true);
    for (let n = 0; n < MOST + 20; n++) faults.report(fault(String(n)));
    for (let n = 0; n < MOST + 20; n++) tick();
    expect(sent).toEqual(Array.from({ length: MOST }, (_, n) => String(n)));
  });

  test("have a detail the script takes, however long what was said", () => {
    const sent: Fault[] = [];
    const faults = new Faults((f) => void sent.push(f), () => 0 as unknown as ReturnType<typeof setTimeout>);
    faults.served(true);
    faults.report(fault("x".repeat(LONG + 1)));
    expect(sent[0]!.detail).toHaveLength(LONG);
  });

  test("a report that cannot be sent is swallowed, and the next one goes", () => {
    const sent: string[] = [];
    let due: (() => void) | undefined;
    const faults = new Faults(
      (f) => {
        if (f.detail === "first") throw new Error("no network");
        sent.push(f.detail);
      },
      (then) => ((due = then), 0 as unknown as ReturnType<typeof setTimeout>),
    );
    faults.served(true);
    expect(() => faults.report(fault("first"))).not.toThrow();
    faults.report(fault("second"));
    due?.();
    expect(sent).toEqual(["second"]);
  });
});

describe("what an error says", () => {
  const thrown = (name: string, message: string, stack: string | undefined) => Object.assign(new Error(message), { name, stack });

  test("its message and the first line of its stack, where the stack starts with the message", () => {
    const err = thrown("TypeError", "x is not a function", "TypeError: x is not a function\n    at frame (http://yard/assets/index.js:12:3)\n    at start (http://yard/assets/index.js:40:1)");
    expect(told(err)).toBe("TypeError: x is not a function (frame (http://yard/assets/index.js:12:3))");
  });

  test("and where it starts with the line itself", () => {
    const err = thrown("TypeError", "x is not a function", "frame@http://yard/assets/index.js:12:3\nstart@http://yard/assets/index.js:40:1\n");
    expect(told(err)).toBe("TypeError: x is not a function (frame@http://yard/assets/index.js:12:3)");
  });

  test("a message of several lines is not taken for the stack's", () => {
    const err = thrown("Error", "one\ntwo", "Error: one\ntwo\n    at frame (index.js:1:1)");
    expect(told(err)).toBe("Error: one\ntwo (frame (index.js:1:1))");
  });

  test("without a stack, where the browser said it was, or the message alone", () => {
    expect(told(thrown("Error", "gone", undefined), "index.js:3:9")).toBe("Error: gone (index.js:3:9)");
    expect(told(thrown("Error", "gone", undefined))).toBe("Error: gone");
    expect(told(thrown("Error", "", "Error\n    at frame (index.js:1:1)"))).toBe("Error (frame (index.js:1:1))");
  });

  test("what was thrown and is no error is said as it is", () => {
    expect(told("Script error.", "http://other/x.js:0:0")).toBe("Script error. (http://other/x.js:0:0)");
    expect(told(undefined)).toBe("undefined");
  });
});
