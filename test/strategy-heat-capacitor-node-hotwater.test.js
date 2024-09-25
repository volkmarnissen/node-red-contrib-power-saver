"use strict";
const { DateTime } = require("luxon");
const expect = require("chai").expect;
const helper = require("node-red-node-test-helper");
const node = require("../src/strategy-heat-capacitor.js");

helper.init(require.resolve("node-red"));

// Example usage for hot water generation with dynamic configuration
// Input from user: 
// -- set point temperatures 48
// Input from sensors: 
// -- current hot water temperatures (44,45,46,47,48)
// -- hysteresis 3 
// -- cooling time 
//    calculated delta of two hot water temperatures divided by time between measurement
//    a) Use case no hotwater usage: 3 degree/ day
//    b) water usage during cool down time: 3/0.5h
//    timeCool1C ( 24h/3 degree, 10min/4 degree  ) = ( 3 * 60 / 24, 10 /4 ) 
// current time:
// 00:30 01:30
// static input:
// Schedules:
// 1.1 00:00-01:00 10
// 1.2 00:01-02:00 8
// timeHeat1C (45 min for 4 degree ) = 45/4
// minSavings: 1
// Dynamic Configuration:
// boostTempHeat =  set point temp - hot water temperature
// boostTempCool =  hot water temperature - set point temp + hysteresis
//     E.g  46 - 48 +  3 = 1
// maxTempAdjustment = hysteresis
// Expected behaviour:
//   a) hot water temperature is in the range from set point temperature - hysteresis to set point temperature
//     then: output temperature equal or above set point temperature for cheapest time segment 
//           for the other time segment, it is in the range from set point temperature - hysteresis to set point temperature
//   b) hot water temperature is below set point temperature - hysteresis
//     then output temperature equal or above set point temperature for all time segments  
// 
//  otherwise 

const setPointTemperature = 48
const timeHeat1C =  45 / 4
const hotWaterTemperatures = [ 44,45,46,47,48]
const hysteresis = 3
const coolingTimes = [ 60 / 24 / 3, 10 / 4 ]
const currentTimes = ["2021-10-11T00:30:00.XXX+02:00" ,"2021-10-11T01:30:00.XXX+02:00" ]
const prices = [
{
    "source": "Tibber",
    "priceData": [
      {
        "value": 10,
        "start": "2021-10-11T00:00:00.000+02:00"
      },
      {
        "value": 8,
        "start": "2021-10-11T01:00:00.000+02:00"
      }
    ]
}    
]

let inputData = [];
let csvString=""

describe("ps-strategy-heat-capacitor hot water ", function () {
  this.timeout(5000); 
  beforeEach(function (done) {
    helper.startServer(done);
  });

  afterEach(function (done) {
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  it("Set configuration for every calculation",  function (done) {
    const flow = makeFlow();
    inputData = [];
    
    helper.load(node, flow, function () {
    const strategyNode = helper.getNode("strategyNode");
    let idx = 0;

    const temperatureNode = helper.getNode("temperature");
    temperatureNode.on("input", function (msg) {
      try{
        let inp = inputData[msg.time.millisecond]
        buildCsv(msg.payload, inp)

        validateTemperature( msg.payload, inp)
        strategyNode.warn.should.not.be.called;
        if( msg.time.millisecond == inputData.length -1){
          console.log(csvString)
          done()
        }
          
      }
      catch(e){
        console.log(e)
      }
    });
     let priceIdx = -1
     for(  const price of prices){
        priceIdx++
        // set up temperature receive node to validate result
        let timeIdx = -1
        for(  const currentTime of currentTimes){
            timeIdx++;
            let coolingIdx = -1;
            for( const coolingTime in coolingTimes){
              coolingIdx++;
              let tempIdx = -1;
              for(const hotWaterTemperature of hotWaterTemperatures){
                tempIdx++;
                // configure node
                let inp =  {
                       time: DateTime.fromISO(currentTime.replace("XXX", idx.toString().padStart(3,"0"))),
                       config: {
                           timeHeat1C: timeHeat1C,
                           timeCool1C: coolingTimes[coolingTime],
                           setpoint: setPointTemperature,
                           maxTempAdjustment: setPointTemperature - hotWaterTemperature,
                           minSavings: 1,
                           boostTempHeat: Math.max(setPointTemperature - hotWaterTemperature,0),
                           boostTempCool: Math.max(hotWaterTemperature - setPointTemperature + hysteresis,0),
                       },
                       source: price.source,
                       priceData: price.priceData,
                       tempIdx:  tempIdx,
                       timeIdx: timeIdx,
                       priceIdx: priceIdx,
                       coolingIdx: coolingIdx
                   }
               inputData.push( inp)
               idx++;
               strategyNode.receive({ payload:inp});
           }
         }
            }
           
     }
  });
});
});

function makeFlow() {
  return [
    {
      id: "strategyNode",
      type: "ps-strategy-heat-capacitor",
      name: "Temp. Adj.",
      wires: [["temperature"]],
    },
    { id: "temperature", type: "helper" },
  ];
}


//   a) hot water temperature is in the range from set point temperature - hysteresis to set point temperature
//     then: output temperature equal or above set point temperature for cheapest time segment 
//           for the other time segment, it is in the range from set point temperature - hysteresis to set point temperature
//   b) hot water temperature is below set point temperature - hysteresis
//     then output temperature equal or above set point temperature for all time segments  
// 
function validateTemperature(temp, input){
  let hotWaterTemperature = hotWaterTemperatures[input.tempIdx];
  let currentTime = input.time;
  let cheapest = (input.timeIdx == 1)
  if( inRange(hotWaterTemperature, hotWaterTemperature - hysteresis, hotWaterTemperature)){
      if(cheapest ){ // cheapest segment => high set point
            expect( temp ,"Expected cheapest price segment" + getInputDataAsString(temp,input)).to.be.greaterThanOrEqual(input.config.setpoint)
      }
      else
         expect(temp,"Temperature should be in the Range " + getInputDataAsString(temp,input)).to.be.greaterThanOrEqual( hotWaterTemperature - hysteresis, hotWaterTemperature)
  }
  if(temp < hotWaterTemperature - hysteresis)
    expect( temp, "Temp should be greater than set point").to.be.greaterThanOrEqual(input.config.setpoint)
}


function buildCsv(temp, input){
  let hotWaterTemperature = hotWaterTemperatures[input.tempIdx];
  let priceSegment = input.time.hour;
  let s =  "\n" + input.time.millisecond + ";" + temp + ";" +hotWaterTemperature + ";" + input.config.setpoint + ";" + (input.config.setpoint  - hysteresis) + ";"  +
      input.config.boostTempHeat + ";" + input.config.boostTempCool + ";" + (input.coolingIdx == 0 ? "idle" : "shower")  + ";" + 
      (priceSegment? "expensive":"cheap")
  console.log(s)
  csvString = csvString + s
}
function getInputDataAsString(temp, input){
  let hotWaterTemperature = hotWaterTemperatures[input.tempIdx];
  let currentTime = input.time;
  return "setPoint: " + hotWaterTemperature + " time: " + currentTime +
    " outputTemp: " + temp + " priceidx: " + input.priceIdx ;
}

function inRange( value, min, max){
  if( min > value)
      return false
  if( max < value )
    return false
  return true
}