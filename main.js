"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios").default;
const Json2iob = require("./lib/json2iob");

class Seko extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "seko",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.deviceObject = { language: "de", devicesIDS: {}, appType: "DWI" };
        this.json2iob = new Json2iob(this);
        this.requestClient = axios.create();
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        if (!this.config.username || !this.config.password) {
            this.log.error("Please set username and password in the instance settings");
            return;
        }

        this.updateInterval = null;
        this.reLoginTimeout = null;
        this.refreshTokenTimeout = null;
        this.session = {};
        this.subscribeStates("*");

        await this.login();
        if (this.session.token) {
            await this.getDeviceList();
            await this.updateDevices();
            this.updateInterval = setInterval(async () => {
                await this.updateDevices();
            }, this.config.interval * 60 * 1000);
            this.refreshTokenInterval = setInterval(() => {
                this.refreshToken();
            }, this.session.expires_in * 1000);
        }
    }
    async login() {
        await this.requestClient({
            method: "post",
            url: "https://api.sekoweb.com/v1/account/login",
            headers: {
                Host: "api.sekoweb.com",
                "Content-Type": "application/json",
                Origin: "app://localhost",
                Accept: "application/json",
                ownerID: "GBL00001ENDUSERS",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
                Authorization: "Basic ZDAybWFMR1FaRzlBdlFDVDpiV25PdWpsd1NwQ0tMVjZJa3BiMWJ6RjdxdWpNT0JuTA==",
                "Accept-Language": "de-de",
            },
            data: JSON.stringify({
                email: this.config.username,
                password: this.config.password,
            }),
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));
                this.setState("info.connection", true, true);
                this.log.info("Login successful");
                this.session = res.data;
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async getDeviceList() {
        await this.requestClient({
            method: "post",
            url: "https://api.sekoweb.com/pgcController/installationSitesList",
            headers: {
                Host: "api.sekoweb.com",
                "Content-Type": "application/json",
                Origin: "app://localhost",
                Accept: "application/json",
                ownerID: "PGC",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
                Authorization: "Basic ZDAybWFMR1FaRzlBdlFDVDpiV25PdWpsd1NwQ0tMVjZJa3BiMWJ6RjdxdWpNT0JuTA==",
                "Accept-Language": "de-de",
            },
            data: JSON.stringify({
                email: this.config.username,
                language: "de",
            }),
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));
                if (res.data.installationsSites.length === 0) {
                    this.log.error("No installationsSites found");
                    return;
                }
                const data = res.data.installationsSites[0];
                this.deviceObject.appType = data.groupType;
                this.log.info(`Found ${data.devices.length} devices`);
                for (const deviceId in data.devices) {
                    const device = data.devices[deviceId];
                    const id = deviceId;
                    this.deviceObject.devicesIDS[id] = device.type;
                    const name = device.device_name || "";

                    await this.setObjectNotExistsAsync(id, {
                        type: "device",
                        common: {
                            name: name,
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(id + ".remote", {
                        type: "channel",
                        common: {
                            name: "Remote Controls",
                        },
                        native: {},
                    });

                    const remoteArray = [{ command: "Refresh", name: "True = Refresh" }];
                    remoteArray.forEach((remote) => {
                        this.setObjectNotExists(id + ".remote." + remote.command, {
                            type: "state",
                            common: {
                                name: remote.name || "",
                                type: remote.type || "boolean",
                                role: remote.role || "boolean",
                                def: remote.def || false,
                                write: true,
                                read: true,
                            },
                            native: {},
                        });
                    });
                    this.json2iob.parse(id, device, { forceIndex: true });
                }
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async updateDevices() {
        await this.requestClient({
            method: "post",
            url: "https://api.sekoweb.com/v1/devices/getInstantValues",
            headers: {
                Host: "api.sekoweb.com",
                Accept: "application/json",
                Authorization: "Basic ZDAybWFMR1FaRzlBdlFDVDpiV25PdWpsd1NwQ0tMVjZJa3BiMWJ6RjdxdWpNT0JuTA==",
                ownerID: "GBL00001ENDUSERS",
                "Accept-Language": "de-de",
                TOKEN: this.session.token,
                "Content-Type": "application/json",
                Origin: "app://localhost",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            },
            data: JSON.stringify(this.deviceObject),
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));
                if (!res.data) {
                    return;
                }
                const data = res.data.devicedata;
                for (const device of data) {
                    for (const id in device.devicedata) {
                        const value = device.devicedata[id];
                        const forceIndex = true;
                        this.json2iob.parse(id, value, { forceIndex: forceIndex });
                    }
                }
                await this.setObjectNotExistsAsync("json", {
                    type: "state",
                    common: {
                        name: "Raw JSON",
                        write: false,
                        read: true,
                        type: "string",
                        role: "json",
                    },
                    native: {},
                });
                this.setState("json", JSON.stringify(data), true);
            })
            .catch((error) => {
                if (error.response) {
                    if (error.response.status === 401) {
                        error.response && this.log.debug(JSON.stringify(error.response.data));
                        this.log.info(element.path + " receive 401 error. Refresh Token in 60 seconds");
                        this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
                        this.refreshTokenTimeout = setTimeout(() => {
                            this.refreshToken();
                        }, 1000 * 60);

                        return;
                    }
                }
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async refreshToken() {
        this.log.debug("Refresh token");
        await this.login();
        return;
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.setState("info.connection", false, true);
            this.refreshTimeout && clearTimeout(this.refreshTimeout);
            this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
            this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
            this.updateInterval && clearInterval(this.updateInterval);
            this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            if (!state.ack) {
                const deviceId = id.split(".")[2];
                const command = id.split(".")[4];
                if (id.split(".")[3] !== "remote") {
                    return;
                }

                if (command === "Refresh") {
                    this.updateDevices();
                    return;
                }
            }
        }
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Seko(options);
} else {
    // otherwise start the instance directly
    new Seko();
}
