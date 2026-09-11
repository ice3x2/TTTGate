import {PubSub, Observer} from "../../../src/util/PubSub";

jest.setTimeout(30_000);

describe("PubSub", () => {
    it("instance is a singleton while create() always returns a fresh instance", () => {
        expect(PubSub.instance).toBe(PubSub.instance);
        expect(PubSub.create()).not.toBe(PubSub.instance);
        expect(PubSub.create()).not.toBe(PubSub.create());
    });

    it("publishes synchronously to subscribers in order when tick publish is disabled", () => {
        const pubSub = PubSub.create();
        pubSub.setTickPublish(false);
        const calls: Array<[string, any]> = [];
        const a: Observer = (topic, message) => calls.push(["a", [topic, message]] as any);
        const b: Observer = (topic, message) => calls.push(["b", [topic, message]] as any);
        pubSub.subscribe("t", a);
        pubSub.subscribe("t", b);

        pubSub.publish("t", "m");

        expect(calls).toEqual([
            ["a", ["t", "m"]],
            ["b", ["t", "m"]]
        ]);
    });

    it("defers delivery with the default tick publish setting", async () => {
        const pubSub = PubSub.create();
        const calls: any[] = [];
        pubSub.subscribe("t", (topic, message) => calls.push([topic, message]));

        pubSub.publish("t", "m");
        expect(calls.length).toBe(0);

        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(calls.length).toBe(1);
    });

    it("unsubscribe removes only the targeted observer", () => {
        const pubSub = PubSub.create();
        pubSub.setTickPublish(false);
        const receivedByA: any[] = [];
        const receivedByB: any[] = [];
        const a: Observer = (topic, message) => receivedByA.push(message);
        const b: Observer = (topic, message) => receivedByB.push(message);
        pubSub.subscribe("t", a);
        pubSub.subscribe("t", b);

        pubSub.unsubscribe("t", a);
        pubSub.publish("t", "x");

        expect(receivedByA).toEqual([]);
        expect(receivedByB).toEqual(["x"]);
        expect(pubSub.hasObserver("t", a)).toBe(false);
        expect(pubSub.hasObserver("t", b)).toBe(true);
    });

    it("unsubscribeAll removes the topic entirely", () => {
        const pubSub = PubSub.create();
        pubSub.setTickPublish(false);
        const received: any[] = [];
        pubSub.subscribe("t", (topic, message) => received.push(message));

        pubSub.unsubscribeAll("t");

        expect(pubSub.hasTopic("t")).toBe(false);
        pubSub.publish("t", "x");
        expect(received).toEqual([]);
    });

    it("publishing to an unknown topic does not throw and reports no observer", () => {
        const pubSub = PubSub.create();

        expect(() => pubSub.publish("none", "x")).not.toThrow();
        expect(pubSub.hasObserver("none", () => {})).toBe(false);
    });

    it("clear() does not throw and leaves existing subscriptions untouched", () => {
        const pubSub = PubSub.create();
        pubSub.setTickPublish(false);
        const received: any[] = [];
        pubSub.subscribe("t", (topic, message) => received.push(message));

        expect(() => pubSub.clear()).not.toThrow();

        pubSub.publish("t", "x");
        expect(received).toEqual(["x"]);
    });
});
