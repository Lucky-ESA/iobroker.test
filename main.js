"use strict";

/*
 * Created with @iobroker/create-adapter v1.34.1
 * Based on https://github.com/nVuln/homebridge-lg-thinq
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");
const crypto = require("crypto");
const uuid = require("uuid");
const qs = require("qs");
const { DateTime } = require("luxon");
const { extractKeys } = require("./lib/extractKeys");
const constants = require("./lib/constants");
const { URL } = require("url");

class Test extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "test",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        if (this.config.newinterval < 1) {
            this.log.info("Set newinterval to minimum 1. New interval is 4 seconds!");
            this.config.newinterval = 4;
        }

        this.oldinterval        = this.config.interval * 60;
        this.config.interval    = this.config.interval * 60;
        this.setinterval        = false;
        this.stopinterval       = false;
        this.adapterstart       = true;
        this.courseload         = {};

        // @ts-ignore
        this.requestClient = axios.create();
        this.updateInterval = null;
        this.session = {};
        this.modelInfos = {};
        this.auth = {};
        this.workIds = [];
        this.deviceControls = {};
        this.deviceJson = {};
        this.courseJson = {};
        this.courseactual = {};
        this.extractKeys = extractKeys;
        this.subscribeStates("*");
        this.targetKeys = {};

        this.defaultHeaders = {
            "x-api-key": constants.API_KEY,
            "x-client-id": constants.API_CLIENT_ID,
            "x-thinq-app-ver": "3.5.1700",
            "x-thinq-app-type": "NUTS",
            "x-thinq-app-level": "PRD",
            "x-thinq-app-os": "ANDROID",
            "x-thinq-app-logintype": "LGE",
            "x-service-code": "SVC202",
            "x-country-code": this.config.country,
            "x-language-code": this.config.language,
            "x-service-phase": "OP",
            "x-origin": "app-native",
            "x-model-name": "samsung / SM-N950N",
            "x-os-version": "7.1.2",
            "x-app-version": "3.5.1721",
            "x-message-id": this.random_string(22),
        };

        this.gateway = await this.requestClient
            .get(constants.GATEWAY_URL, { headers: this.defaultHeaders })
            .then((res) => res.data.result)
            .catch((error) => {
                this.log.error(error);
            });
        if (this.gateway) {
            this.lgeapi_url = `https://${this.gateway.countryCode.toLowerCase()}.lgeapi.com/`;

            this.session = await this.login(this.config.user, this.config.password).catch((error) => {
                this.log.error(error);
            });
            if (this.session && this.session.access_token) {
                this.log.debug(JSON.stringify(this.session));
                this.setState("info.connection", true, true);
                this.log.info("Login successful");
                this.refreshTokenInterval = setInterval(() => {
                    this.refreshNewToken();
                }, this.session.expires_in * 1000);
                this.userNumber = await this.getUserNumber();
                this.defaultHeaders["x-user-no"] = this.userNumber;
                this.defaultHeaders["x-emp-token"] = this.session.access_token;
                const listDevices = await this.getListDevices();

                this.log.info("Found: " + listDevices.length + " devices");
                listDevices.forEach(async (element) => {
                    await this.setObjectNotExistsAsync(element.deviceId, {
                        type: "device",
                        common: {
                            name: element.alias,
                            role: "state",
                        },
                        native: {},
                    });
                    this.extractKeys(this, element.deviceId, element, null, false, true);
                    this.modelInfos[element.deviceId] = await this.getDeviceModelInfo(element);
                    await this.pollMonitor(element);
                    await this.sleep(2000);
                    this.extractValues(element);
                });

                this.log.debug(JSON.stringify(listDevices));
                this.NewInterval();
            }
        }
    }

    async NewInterval() {
        this.updateInterval = setInterval(async () => {
            if (this.stopinterval) {
                this.stopinterval = false;
                await clearInterval(this.updateInterval);
                this.updateInterval = null;
                this.NewInterval();
            } else {
                await this.updateDevices();
            }
        }, this.config.interval * 1000);
    }

    async updateDevices() {
        let listDevices = await this.getListDevices().catch((error) => {
            this.log.error(error);
        });
        let devID = "";
        listDevices.forEach(async (element) => {
            if (element.deviceType) {
                if (this.config.devtype.includes(element.deviceType) && this.config.newinterval > 0) {
                    if (element["snapshot"]["washerDryer"]["state"] !== undefined) {
                        if (element["snapshot"]["washerDryer"]["state"] !== "POWEROFF") {
                            if (this.setinterval === false) {
                                this.setinterval = true;
                                this.config.interval = this.config.newinterval;
                                this.stopinterval = true;
                            }
                        } else {
                            if (this.setinterval) {
                                this.setinterval = false;
                                this.config.interval = this.oldinterval;
                                this.stopinterval = true;
                            }
                        }
                    }
                }
            }
            if (this.adapterstart === false) {
                await this.setStateAsync(element.deviceId + ".online", {
                    val: element.snapshot.online,
                    ack: true
                });
                devID = element.deviceId + ".snapshot";
                element = element.snapshot;
            } else {
                devID = element.deviceId;
            }
            this.extractKeys(this, devID, element);
            this.pollMonitor(element);
        });
        this.adapterstart = false;
        this.log.debug(JSON.stringify(listDevices));
    }

    async login(username, password) {
        // get signature and timestamp in login form
        const loginForm = await this.requestClient.get(await this.getLoginUrl()).then((res) => res.data);
        const headers = {
            Accept: "application/json",
            "X-Application-Key": constants.APPLICATION_KEY,
            "X-Client-App-Key": constants.CLIENT_ID,
            "X-Lge-Svccode": "SVC709",
            "X-Device-Type": "M01",
            "X-Device-Platform": "ADR",
            "X-Device-Language-Type": "IETF",
            "X-Device-Publish-Flag": "Y",
            "X-Device-Country": this.gateway.countryCode,
            "X-Device-Language": this.gateway.languageCode,
            "X-Signature": loginForm.match(/signature\s+:\s+"([^"]+)"/)[1],
            "X-Timestamp": loginForm.match(/tStamp\s+:\s+"([^"]+)"/)[1],
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        };

        const hash = crypto.createHash("sha512");
        const data = {
            user_auth2: hash.update(password).digest("hex"),
            itg_terms_use_flag: "Y",
            svc_list: "SVC202,SVC710", // SVC202=LG SmartHome, SVC710=EMP OAuth
        };

        // try login with username and hashed password
        const loginUrl = this.gateway.empTermsUri + "/" + "emp/v2.0/account/session/" + encodeURIComponent(username);
        const res = await this.requestClient
            .post(loginUrl, qs.stringify(data), { headers })
            .then((res) => res.data)
            .catch((err) => {
                if (!err.response) {
                    this.log.error(err);
                    return;
                }
                this.log.error(JSON.stringify(err.response.data));
                const { code, message } = err.response.data.error;
                if (code === "MS.001.03") {
                    this.log.error("Double-check your country in configuration");
                }
                return;
            });
        if (!res) {
            return;
        }
        // dynamic get secret key for emp signature
        const empSearchKeyUrl = this.gateway.empSpxUri + "/" + "searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP";
        const secretKey = await this.requestClient
            .get(empSearchKeyUrl)
            .then((res) => res.data)
            .then((data) => data.returnData);

        const timestamp = DateTime.utc().toRFC2822();
        const empData = {
            account_type: res.account.userIDType,
            client_id: constants.CLIENT_ID,
            country_code: res.account.country,
            username: res.account.userID,
        };
        const empUrl = "/emp/oauth2/token/empsession" + qs.stringify(empData, { addQueryPrefix: true });
        const signature = this.signature(`${empUrl}\n${timestamp}`, secretKey);
        const empHeaders = {
            "lgemp-x-app-key": constants.OAUTH_CLIENT_KEY,
            "lgemp-x-date": timestamp,
            "lgemp-x-session-key": res.account.loginSessionID,
            "lgemp-x-signature": signature,
            Accept: "application/json",
            "X-Device-Type": "M01",
            "X-Device-Platform": "ADR",
            "Content-Type": "application/x-www-form-urlencoded",
            "Access-Control-Allow-Origin": "*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
        };
        // create emp session and get access token
        const token = await this.requestClient
            .post("https://emp-oauth.lgecloud.com/emp/oauth2/token/empsession", qs.stringify(empData), {
                headers: empHeaders,
            })
            .then((res) => res.data)
            .catch((err) => {
                this.log.error(err.response.data.error.message);
                return;
            });
        if (token.status !== 1) {
            this.log.error(token.message);
            return;
        }

        this.lgeapi_url = token.oauth2_backend_url || this.lgeapi_url;

        return token;
    }

    async pollMonitor(device) {
        if (device.platformType === "thinq1") {
            this.log.debug("start polling");
            let result = new Uint8Array(1024);
            try {
                if (!(device.deviceId in this.workIds)) {
                    this.log.debug(device.deviceId + " is connecting");
                    await this.startMonitor(device);
                    await this.sleep(5000);
                }
                result = await this.getMonitorResult(device.deviceId, this.workIds[device.deviceId]);
                if (result && typeof result === "object") {
                    let resultConverted;
                    if (this.modelInfos[device.deviceId].Monitoring.type === "BINARY(BYTE)") {
                        resultConverted = this.decodeMonitorBinary(result, this.modelInfos[device.deviceId].Monitoring.protocol);
                    }
                    if (this.modelInfos[device.deviceId].Monitoring.type === "JSON") {
                        resultConverted = JSON.parse(result.toString("utf-8"));
                    }
                    this.log.debug(JSON.stringify(resultConverted));
                    await extractKeys(this, device.deviceId + ".snapshot", resultConverted);
                    return resultConverted;
                } else {
                    this.log.debug("No data:" + JSON.stringify(result) + " " + device.deviceId);
                }
                await this.stopMonitor(device);
            } catch (err) {
                this.log.error(err);
            }
        }
    }
    async startMonitor(device) {
        try {
            if (device.platformType === "thinq1") {
                const sendId = uuid.v4();
                const returnWorkId = await this.sendMonitorCommand(device.deviceId, "Start", sendId).then((data) => data.workId);
                this.workIds[device.deviceId] = returnWorkId;
            }
        } catch (err) {
            this.log.error(err);
        }
    }

    async stopMonitor(device) {
        if (device.platformType === "thinq1" && device.deviceId in this.workIds) {
            try {
                await this.sendMonitorCommand(device.deviceId, "Stop", this.workIds[device.deviceId]);
                delete this.workIds[device.deviceId];
            } catch (err) {
                this.log.error(err);
            }
        }
    }
    decodeMonitorBinary(data, protocol) {
        const decoded = {};

        for (const item of protocol) {
            const key = item.value;
            let value = 0;

            for (let i = item.startByte; i < item.startByte + item.length; i++) {
                const v = data[i];
                value = (value << 8) + v;
                decoded[key] = String(value);
            }
        }

        return decoded;
    }
    async refreshNewToken() {
        this.log.debug("refreshToken");
        const tokenUrl = this.lgeapi_url + "oauth2/token";
        const data = {
            grant_type: "refresh_token",
            refresh_token: this.session.refresh_token,
        };

        const timestamp = DateTime.utc().toRFC2822();

        const requestUrl = "/oauth2/token" + qs.stringify(data, { addQueryPrefix: true });
        const signature = this.signature(`${requestUrl}\n${timestamp}`, constants.OAUTH_SECRET_KEY);

        const headers = {
            "lgemp-x-app-key": constants.CLIENT_ID,
            "lgemp-x-signature": signature,
            "lgemp-x-date": timestamp,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        };
        const resp = await this.requestClient
            .post(tokenUrl, qs.stringify(data), { headers })
            .then((resp) => resp.data)
            .catch((error) => {
                this.log.error(error);
            });
        this.log.debug(JSON.stringify(resp));
        if (this.session) {
            this.session.access_token = resp.access_token;
            this.defaultHeaders["x-emp-token"] = this.session.access_token;
        }
    }

    async getUserNumber() {
        const profileUrl = this.lgeapi_url + "users/profile";
        const timestamp = DateTime.utc().toRFC2822();
        const signature = this.signature(`/users/profile\n${timestamp}`, constants.OAUTH_SECRET_KEY);

        const headers = {
            Accept: "application/json",
            Authorization: "Bearer " + this.session.access_token,
            "X-Lge-Svccode": "SVC202",
            "X-Application-Key": constants.APPLICATION_KEY,
            "lgemp-x-app-key": constants.CLIENT_ID,
            "X-Device-Type": "M01",
            "X-Device-Platform": "ADR",
            "x-lge-oauth-date": timestamp,
            "x-lge-oauth-signature": signature,
        };

        const resp = await this.requestClient
            .get(profileUrl, { headers })
            .then((resp) => resp.data)
            .catch((error) => {
                this.log.error(error);
            });
        this.extractKeys(this, "general", resp);
        this.log.debug(JSON.stringify(resp));
        return resp.account.userNo;
    }

    async getLoginUrl() {
        const params = {
            country: this.gateway.countryCode,
            language: this.gateway.languageCode,
            client_id: constants.CLIENT_ID,
            svc_list: constants.SVC_CODE,
            svc_integrated: "Y",
            redirect_uri: this.gateway.empSpxUri + "/" + "login/iabClose",
            show_thirdparty_login: "LGE,MYLG",
            division: "ha:T20",
            callback_url: this.gateway.empSpxUri + "/" + "login/iabClose",
        };

        return this.gateway.empSpxUri + "/" + "login/signIn" + qs.stringify(params, { addQueryPrefix: true });
    }

    async sendMonitorCommand(deviceId, cmdOpt, workId) {
        const headers = Object.assign({}, this.defaultHeaders);
        headers["x-client-id"] = constants.API1_CLIENT_ID;
        const data = {
            cmd: "Mon",
            cmdOpt,
            deviceId,
            workId,
        };
        return await this.requestClient
            .post(this.gateway.thinq1Uri + "/" + "rti/rtiMon", { lgedmRoot: data }, { headers })
            .then((res) => res.data.lgedmRoot)
            .then((data) => {
                if ("returnCd" in data) {
                    const code = data.returnCd;
                    if (code === "0106") {
                        this.log.error(data.returnMsg || "");
                    } else if (code !== "0000") {
                        this.log.error(code + " - " + data.returnMsg || "");
                    }
                }
                this.log.debug(JSON.stringify(data));
                return data;
            })
            .catch((error) => {
                this.log.error(error);
            });
    }

    async getMonitorResult(device_id, work_id) {
        const headers = Object.assign({}, this.defaultHeaders);
        headers["x-client-id"] = constants.API1_CLIENT_ID;
        const workList = [{ deviceId: device_id, workId: work_id }];
        return await this.requestClient
            .post(this.gateway.thinq1Uri + "/" + "rti/rtiResult", { lgedmRoot: { workList } }, { headers })
            .then((resp) => resp.data.lgedmRoot)
            .then((data) => {
                if ("returnCd" in data) {
                    const code = data.returnCd;
                    if (code === "0106") {
                        return code;
                    } else if (code !== "0000") {
                        this.log.error(code + " - " + data.returnMsg || "");
                        return code;
                    }
                }
                this.log.debug(JSON.stringify(data));
                const workList = data.workList;
                if (!workList || workList.returnCode !== "0000") {
                    this.log.debug(JSON.stringify(data));
                    return null;
                }

                if (!("returnData" in workList)) {
                    return null;
                }

                return Buffer.from(workList.returnData, "base64");
            })
            .catch((error) => {
                this.log.error(error);
            });
    }

    signature(message, secret) {
        return crypto.createHmac("sha1", Buffer.from(secret)).update(message).digest("base64");
    }
    random_string(length) {
        const result = [];
        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
        }
        return result.join("");
    }
    resolveUrl(from, to) {
        const url = new URL(to, from);
        return url.href;
    }
    async getDeviceInfo(deviceId) {
        const headers = this.defaultHeaders;
        const deviceUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/devices/" + deviceId);

        return this.requestClient
            .get(deviceUrl, { headers })
            .then((res) => res.data.result)
            .catch((error) => {
                this.log.error(error);
            });
    }

    async getListDevices() {
        if (!this.homes) {
            this.homes = await this.getListHomes();
            if (!this.homes) {
                this.log.error("Could not receive homes. Please check your app and accept new agreements");
                return [];
            }
            this.extractKeys(this, "homes", this.homes);
        }
        const headers = this.defaultHeaders;
        const devices = [];

        // get all devices in home
        for (let i = 0; i < this.homes.length; i++) {
            const homeUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/homes/" + this.homes[i].homeId);
            const resp = await this.requestClient
                .get(homeUrl, { headers })
                .then((res) => res.data)
                .catch((error) => {
                    this.log.debug("Failed to get home");
                    this.log.error(error);
                    if (error.response && error.response.data) {
                        this.log.error(JSON.stringify(error.response.data));
                    }
                    if (error.response && error.response.status === 400) {
                        this.log.info("Try to refresh Token");
                        this.refreshNewToken();
                    }
                    return;
                });

            this.log.debug(JSON.stringify(resp));
            if (resp) {
                this.log.debug(JSON.stringify(resp));
                devices.push(...resp.result.devices);
            }
        }

        return devices;
    }

    async getListHomes() {
        if (!this._homes) {
            const headers = this.defaultHeaders;
            const homesUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/homes");
            this._homes = await this.requestClient
                .get(homesUrl, { headers })
                .then((res) => res.data)
                .then((data) => data.result.item)
                .catch((error) => {
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                });
        }

        return this._homes;
    }
    async getDeviceModelInfo(device) {
        if (!device.modelJsonUri) {
            return;
        }
        const deviceModel = await this.requestClient
            .get(device.modelJsonUri)
            .then((res) => res.data)
            .catch((error) => {
                this.log.error(error);
                return;
            });
        if (deviceModel) {
            await this.setObjectNotExistsAsync(device.deviceId + ".remote", {
                type: "channel",
                common: {
                    name: "remote control device",
                    role: "state",
                },
                native: {},
            });
            if (deviceModel["ControlWifi"]) {
                this.log.debug(JSON.stringify(deviceModel["ControlWifi"]));
                let controlWifi = deviceModel["ControlWifi"];
                if (deviceModel["ControlWifi"].action) {
                    controlWifi = deviceModel["ControlWifi"].action;
                }
                this.deviceControls[device.deviceId] = controlWifi;
                this.deviceJson[device.deviceId] = deviceModel;

                const controlId = deviceModel["Info"].productType + "Control";
                await this.setObjectNotExistsAsync(device.deviceId + ".remote", {
                    type: "channel",
                    common: {
                        name: "remote control device",
                        role: "state",
                    },
                    native: {},
                });
                if (deviceModel["Info"].productType === "REF") {
                    await this.setObjectNotExists(device.deviceId + ".remote.fridgeTemp", {
                        type: "state",
                        common: {
                            name: "fridgeTemp_C",
                            type: "number",
                            write: true,
                            read: true,
                            role: "level",
                            desc: "Nur Celsius",
                            min: 1,
                            max: 7,
                            unit: "",
                            def: 1,
                            states: {
                                1: "7",
                                2: "6",
                                3: "5",
                                4: "4",
                                5: "3",
                                6: "2",
                                7: "1",
                            },
                        },
                        native: {},
                    });
                    await this.setObjectNotExists(device.deviceId + ".remote.freezerTemp", {
                        type: "state",
                        common: {
                            name: "freezerTemp_C",
                            type: "number",
                            write: true,
                            read: true,
                            role: "level",
                            desc: "Nur Celsius",
                            min: 1,
                            max: 11,
                            unit: "",
                            def: 1,
                            states: {
                                1: "-14",
                                2: "-15",
                                3: "-16",
                                4: "-17",
                                5: "-18",
                                6: "-19",
                                7: "-20",
                                8: "-21",
                                9: "-22",
                                10: "-23",
                                11: "-24",
                            },
                        },
                        native: {},
                    });
                    await this.setObjectNotExists(device.deviceId + ".remote.expressMode", {
                        type: "state",
                        common: {
                            name: "expressMode",
                            type: "boolean",
                            write: true,
                            read: true,
                            role: "state",
                            desc: "Expressmode",
                            def: false,
                            states: {
                                true: "EXPRESS_ON",
                                false: "OFF",
                            },
                        },
                        native: {},
                    });
                    await this.setObjectNotExists(device.deviceId + ".remote.ecoFriendly", {
                        type: "state",
                        common: {
                            name: "ecoFriendly",
                            type: "boolean",
                            write: true,
                            read: true,
                            role: "state",
                            desc: "Umweltfreundlich. Nicht f�r alle verf�gbar",
                            def: false,
                            states: {
                                true: "ON",
                                false: "OFF",
                            },
                        },
                        native: {},
                    });
                } else {
                    controlWifi &&
                        Object.keys(controlWifi).forEach((control) => {
                            if (control === "WMDownload") {
                                this.createremote(device.deviceId, control, deviceModel);
                            } else {
                                this.setObjectNotExists(device.deviceId + ".remote." + control, {
                                    type: "state",
                                    common: {
                                        name: control,
                                        type: "boolean",
                                        role: "boolean",
                                        write: true,
                                        read: true,
                                    },
                                    native: {},
                                });
                            }
                        });
                }
            }
        }
        return deviceModel;
    }

    createremote(devicedp, control, course) {
        try {
            let states = {};
            let dev    = "";
            this.courseJson[devicedp] = {};
            this.courseactual[devicedp] = {};
            if (control === "WMDownload") {
                Object.keys(course["Course"]).forEach( async (value) => {
                    states[value] = (constants["Translation"][value]) ? constants["Translation"][value] : "Unbekannt";
                });
                Object.keys(course["SmartCourse"]).forEach( async (value) => {
                    states[value] = (constants["Translation"][value]) ? constants["Translation"][value] : "Unbekannt";
                });
                this.setObjectNotExists(devicedp + ".remote.Course", {
                    type: "channel",
                    common: {
                        name: "Auswahl Programm",
                        role: "value",
                    },
                    native: {},
                }).catch((error) => {
                    this.log.error(error);
                });
                this.setObjectNotExists(devicedp + ".remote." + control, {
                    type: "state",
                    common: {
                        name: control,
                        type: "string",
                        role: "value",
                        write: true,
                        read: true,
                        states: states,
                    },
                    native: {},
                }).catch((error) => {
                    this.log.error(error);
                });
                let common = {};
                dev = Object.keys(this.deviceControls[devicedp]["WMDownload"]["data"])[0];
                dev = this.deviceControls[devicedp]["WMDownload"]["data"][dev];
                Object.keys(dev).forEach( async (value) => {
                    common = {
                        name: "unbekannt",
                        type: "string",
                        role: "value",
                        write: true,
                        read: true,
                    }
                    states = {};
                    if (course["MonitoringValue"][value]) {
                        Object.keys(course["MonitoringValue"][value]["valueMapping"]).forEach( async (map) => {
                            if (map === "min" || map === "max") {
                                common[map] = (course["MonitoringValue"][value]["valueMapping"][map] !== 3) ? course["MonitoringValue"][value]["valueMapping"][map] : 0;
                                common["type"] = "number";
                                common["def"] = 0;
                            } else {
                                states[map] = (constants["Translation"][map]) ? constants["Translation"][map] : states[map]["value"];
                            }
                        });
                        common["name"] = (constants["Translation"][value]) ? constants["Translation"][value] : value;
                        if (Object.keys(states).length > 0) common["states"] = states;
                        this.courseJson[devicedp][value] = dev[value];
                        this.courseactual[devicedp][value] = dev[value];
                        await this.setObjectNotExistsAsync(devicedp + ".remote.Course." + value, {
                            type: "state",
                            common: common,
                            native: {},
                        }).catch((error) => {
                            this.log.error(error);
                        });
                    }
                });
            }
        } catch (e) {
            this.log.error("Error in valueinfolder: " + e);
        }
    }

    extractValues(device) {
        const deviceModel = this.modelInfos[device.deviceId];
        if (deviceModel["MonitoringValue"] || deviceModel["Value"]) {
            this.log.debug("extract values from model");
            let type = "";
            if (device["snapshot"]) {
                Object.keys(device["snapshot"]).forEach((subElement) => {
                    if (subElement !== "meta" && subElement !== "static" && typeof device["snapshot"][subElement] === "object") {
                        type = subElement;
                    }
                });
            }
            let path = device.deviceId + ".snapshot.";
            if (type) {
                path = path + type + ".";
            }

            deviceModel["MonitoringValue"] &&
                Object.keys(deviceModel["MonitoringValue"]).forEach((state) => {
                    this.getObject(path + state, async (err, obj) => {
                        let common = {
                            name: state,
                            type: "mixed",
                            write: false,
                            read: true,
                        };
                        if (obj) {
                            common = obj.common;
                        }
                        common.states = {};
                        if (deviceModel["MonitoringValue"][state]["targetKey"]) {
                            this.targetKeys[state] = [];
                            const firstKeyName = Object.keys(deviceModel["MonitoringValue"][state]["targetKey"])[0];
                            const firstObject = deviceModel["MonitoringValue"][state]["targetKey"][firstKeyName];
                            Object.keys(firstObject).forEach((targetKey) => {
                                this.targetKeys[state].push(firstObject[targetKey]);
                            });
                        }
                        if (deviceModel["MonitoringValue"][state]["valueMapping"]) {
                            if (deviceModel["MonitoringValue"][state]["valueMapping"].max) {
                                common.min = 0; // deviceModel["MonitoringValue"][state]["valueMapping"].min; //reseverdhour has wrong value
                                common.max = deviceModel["MonitoringValue"][state]["valueMapping"].max;
                            } else {
                                const values = Object.keys(deviceModel["MonitoringValue"][state]["valueMapping"]);
                                values.forEach((value) => {
                                    if (deviceModel["MonitoringValue"][state]["valueMapping"][value].label) {
                                        const valueMap = deviceModel["MonitoringValue"][state]["valueMapping"][value];
                                        common.states[valueMap.index] = valueMap.label;
                                    } else {
                                        common.states[value] = value;
                                    }
                                });
                            }
                        }
                        // @ts-ignore
                        await this.setObjectNotExistsAsync(path + state, {
                            type: "state",
                            common: common,
                            native: {},
                        }).catch((error) => {
                            this.log.error(error);
                        });

                        // @ts-ignore
                        this.extendObject(path + state, {
                            common: common,
                        });
                    });
                });
            deviceModel["Value"] &&
                Object.keys(deviceModel["Value"]).forEach((state) => {
                    this.getObject(path + state, async (err, obj) => {
                        if (obj) {
                            const common = obj.common;
                            common.states = {};
                            let valueObject = deviceModel["Value"][state]["option"];
                            if (deviceModel["Value"][state]["value_mapping"]) {
                                valueObject = deviceModel["Value"][state]["value_mapping"];
                            }
                            if (valueObject) {
                                if (valueObject.max) {
                                    common.min = 0; // deviceModel["MonitoringValue"][state]["valueMapping"].min; //reseverdhour has wrong value
                                    common.max = valueObject.max;
                                } else {
                                    const values = Object.keys(valueObject);
                                    values.forEach((value) => {
                                        let content = valueObject[value];
                                        if (typeof content === "string") {
                                            common.states[value] = content.replace("@", "");
                                        }
                                    });
                                }
                            }
                            // @ts-ignore
                            await this.setObjectNotExistsAsync(path + state, {
                                type: "state",
                                common: common,
                                native: {},
                            }).catch((error) => {
                                this.log.error(error);
                            });

                            // @ts-ignore
                            this.extendObject(path + state, {
                                common: common,
                            });
                        }
                    });
                });
        }
    }

    async sendCommandToDevice(deviceId, values, thinq1) {
        const headers = this.defaultHeaders;
        let controlUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/devices/" + deviceId + "/control-sync");
        let data = {
            ctrlKey: "basicCtrl",
            command: "Set",
            ...values,
        };
this.log.info(JSON.stringify(data));
        if (thinq1) {
            controlUrl = this.gateway.thinq1Uri + "/" + "rti/rtiControl";
            data = values;
        }
        return this.requestClient
            .post(controlUrl, data, { headers })
            .then((resp) => resp.data)
            .catch((error) => {
                this.log.error(error);
            });
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            clearInterval(this.SpeedupdateInterval)
            clearInterval(this.updateInterval);
            clearInterval(this.refreshTokenInterval);
            clearTimeout(this.refreshTimeout);

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
                const secsplit  = id.split('.')[id.split('.').length-2];
                const lastsplit = id.split('.')[id.split('.').length-1];
                const deviceId = id.split(".")[2];
                if (secsplit === "Course") {
                    this.courseactual[deviceId][lastsplit] = state.val;
this.log.info(JSON.stringify(this.courseactual[deviceId]));
                return;
                }

                if (id.indexOf(".remote.") !== -1) {
                    let nofor    = true;
                    let action   = id.split(".")[4];
                    let data     = {};
                    let onoff    = "";
                    let response = "";
                    let rawData  = {};
                    let dev      = "";
                    if (["WMStart", "WMDownload", "fridgeTemp", "freezerTemp", "expressMode", "ecoFriendly"].includes(action)) {
                        const dataTemp = await this.getStateAsync(deviceId + ".snapshot.refState.tempUnit");
                        switch (action) {
                            case "fridgeTemp":
                                rawData.data = { refState: { fridgeTemp: state.val, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "freezerTemp":
                                rawData.data = { refState: { freezerTemp: state.val, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "expressMode":
                                onoff = state.val ? "EXPRESS_ON" : "OFF";
                                rawData.data = { refState: { expressMode: onoff, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "ecoFriendly":
                                onoff = state.val ? "ON" : "OFF";
                                rawData.data = { refState: { ecoFriendly: onoff, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "WMDownload":
                                if (this.CheckUndefined(state.val, "Course", deviceId)) {
                                    this.InsertCourse(state.val, deviceId);
                                    return;
                                } else if (this.CheckUndefined(state.val, "SmartCourse", deviceId)) {
                                    rawData = this.deviceControls[deviceId][action];
                                    dev = Object.keys(this.deviceControls[deviceId][action]["data"])[0];
                                    let com = {};
                                    com = this.deviceJson[deviceId]["SmartCourse"][state.val].function;
                                    for(const val of com) {
                                        this.courseactual[deviceId][val["value"]] = val["default"];
                                    }
                                    rawData.data[dev] = {
                                        courseDownloadType: "COURSEDATA",
                                        courseDownloadDataLength: Object.keys(this.courseactual[deviceId]).length + 2,
                                        courseFL24inchBaseTitan: this.deviceJson[deviceId]["SmartCourse"][state.val].Course,
                                        downloadedCourseFL24inchBaseTitan: state.val,
                                        ...this.courseactual[deviceId],
                                    };
this.log.info(JSON.stringify(rawData.data));
                                    this.InsertCourse(state.val, deviceId);
                                } else {
                                    this.log.warn("Command " + action + " and value " + state.val + " not found");
                                    return;
                                }
                                break;
                            case "WMStart":
                                rawData = this.deviceControls[deviceId][action];
                                dev = Object.keys(this.deviceControls[deviceId][action]["data"])[0];
                                const WMState = await this.getStateAsync(deviceId + ".snapshot.remote.WMDownload");
                                if (this.CheckUndefined(WMState, "Course", deviceId)) {
                                     rawData.data[dev] = {
                                        courseFL24inchBaseTitan: WMState,
                                        ...this.courseactual[deviceId],
                                    };
                                } else if (this.CheckUndefined(WMState, "SmartCourse", deviceId)) {
                                     rawData.data[dev] = {
                                        courseFL24inchBaseTitan: this.deviceJson[deviceId]["SmartCourse"][WMState].Course,
                                        smartCourseFL24inchBaseTitan: WMState,
                                        ...this.courseactual[deviceId],
                                    };
                                } else {
                                    this.log.warn("Command " + action + " and value " + state.val + " not found");
                                    return;
                                }
this.log.info(JSON.stringify(rawData.data));
                                break;
                            default:
                                this.log.info("Command " + action + " not found");
                                return;
                                break;
                        }
                        nofor = false;
                        response = "";
                    } else {
                        rawData = this.deviceControls[deviceId][action];
                    }

                    data = { ctrlKey: action, command: rawData.command, dataSetList: rawData.data };

                    if (action === "WMStop" || action === "WMOff") {
                        data.ctrlKey = "WMControl";
                    }

                    this.log.debug(JSON.stringify(data));

                    if (data.dataSetList && nofor) {
                        const type = Object.keys(data.dataSetList)[0];
                        if (type) {
                            for (const dataElement of Object.keys(data.dataSetList[type])) {
                                if (!dataElement.startsWith("control")) {
                                    const dataState = await this.getStateAsync(deviceId + ".snapshot." + type + "." + dataElement);
                                    if (dataState) {
                                        data.dataSetList[dataElement] = dataState.val;
                                    }
                                }
                            }
                        }
                    }
                    if (data.command && data.dataSetList) {
                        this.log.debug(JSON.stringify(data));
                        response = await this.sendCommandToDevice(deviceId, data);

this.log.info(JSON.stringify(response));

                    } else {
                        rawData.value = rawData.value.replace("{Operation}", state.val ? "Start" : "Stop");
                        data = {
                            lgedmRoot: {
                                deviceId: deviceId,
                                workId: uuid.v4(),
                                cmd: rawData.cmd,
                                cmdOpt: rawData.cmdOpt,
                                value: rawData.value,
                                data: "",
                            },
                        };

                        this.log.debug(JSON.stringify(data));
                        response = await this.sendCommandToDevice(deviceId, data, true);
                    }

                    this.log.debug(JSON.stringify(response));
                    if ((response && response.resultCode && response.resultCode !== "0000") || (response && response.lgedmRoot && response.lgedmRoot.returnCd !== "0000")) {
                        this.log.error("Command not succesful");
                        this.log.error(JSON.stringify(response));
                    }
                } else {
                    const object = await this.getObjectAsync(id);
                    const name = object.common.name;
                    const data = { ctrlKey: "basicCtrl", command: "Set", dataKey: name, dataValue: state.val };
                    if (name.indexOf(".operation") !== -1) {
                        data.command = "Operation";
                    }
                    this.log.debug(JSON.stringify(data));
                    const response = await this.sendCommandToDevice(deviceId, data);
                    this.log.debug(JSON.stringify(response));
                    if (response && response.resultCode !== "0000") {
                        this.log.error("Command not succesful");
                        this.log.error(JSON.stringify(response));
                    }
                }
                this.refreshTimeout = setTimeout(async () => {
                    await this.updateDevices();
                }, 10 * 1000);
            } else {
                const idArray = id.split(".");
                const lastElement = idArray.pop();
                if (this.targetKeys[lastElement]) {
                    this.targetKeys[lastElement].forEach((element) => {
                        this.setState(idArray.join(".") + "." + element, state.val, true);
                    });
                }
            }
        }
    }

    InsertCourse(state, device) {
        try {
            Object.keys(this.courseJson[device]).forEach( async (value) => {
                this.courseactual[device][value] = this.courseJson[device][value];
                await this.setStateAsync(device + ".remote.Course." + value, {
                    val: this.courseJson[device][value],
                    ack: true
                });
            });
            let com = {};
            if (this.CheckUndefined(state, "Course", device)) {
                com = this.deviceJson[device]["Course"][state].function;
            } else if (this.CheckUndefined(state, "SmartCourse", device)) {
                com = this.deviceJson[device]["SmartCourse"][state].function;
            } else {
                this.log.warn("Command " + action + " and value " + state.val + " not found");
                return;
            }
            for(const val of com) {
                this.getObject(device + ".remote.Course." + val["value"], async (err, obj) => {
                    if (obj) {
                        this.courseactual[device][val["value"]] = val["default"];
                        await this.setStateAsync(device + ".remote.Course." + val["value"], {
                            val: val["default"],
                            ack: true
                        });
                    }
                });
            }
        } catch (e) {
            this.log.error("Error in InsertCourse: " + e);
        }
    }

    CheckUndefined(value1, value2, value3) {
        try {
            if (this.deviceJson[value3][value2][value1]) return true;
        } catch (e) {
            return false;
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Test(options);
} else {
    // otherwise start the instance directly
    new Test();
}
